package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct holds application state and is bound to the frontend.
type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// VideoInfo describes a probed input file.
type VideoInfo struct {
	Path       string  `json:"path"`
	Name       string  `json:"name"`
	SizeBytes  int64   `json:"sizeBytes"`
	DurationS  float64 `json:"durationSeconds"`
	Width      int     `json:"width"`
	Height     int     `json:"height"`
	VideoCodec string  `json:"videoCodec"`
	AudioCodec string  `json:"audioCodec"`
	BitrateKbs int     `json:"bitrateKbps"`
	FPS        float64 `json:"fps"`
}

// CompressOptions mirrors the settings a user picks in the UI.
type CompressOptions struct {
	InputPath  string `json:"inputPath"`
	OutputPath string `json:"outputPath"`
	Format     string `json:"format"`     // mp4, webm, mkv
	VideoCodec string `json:"videoCodec"` // libx264, libx265, libvpx-vp9
	CRF        int    `json:"crf"`        // 0-51 (x264/x265) or 0-63 (vp9)
	Preset     string `json:"preset"`     // ultrafast..veryslow
	ScalePct   int    `json:"scalePct"`   // 100 = original size, 50 = half resolution
	RemoveAudio bool  `json:"removeAudio"`
}

// CompressResult is returned once a job finishes.
type CompressResult struct {
	OutputPath     string `json:"outputPath"`
	InputSizeBytes int64  `json:"inputSizeBytes"`
	OutputSizeBytes int64 `json:"outputSizeBytes"`
	SavedPercent   float64 `json:"savedPercent"`
}

func ffmpegBinary() string {
	if p := os.Getenv("FFMPEG_PATH"); p != "" {
		return p
	}
	return "ffmpeg"
}

func ffprobeBinary() string {
	if p := os.Getenv("FFPROBE_PATH"); p != "" {
		return p
	}
	return "ffprobe"
}

// CheckFFmpeg reports whether ffmpeg/ffprobe are reachable on PATH.
func (a *App) CheckFFmpeg() map[string]bool {
	_, ffmpegErr := exec.LookPath(ffmpegBinary())
	_, ffprobeErr := exec.LookPath(ffprobeBinary())
	return map[string]bool{
		"ffmpeg":  ffmpegErr == nil,
		"ffprobe": ffprobeErr == nil,
	}
}

// SelectInputFile opens a native file picker for a video.
func (a *App) SelectInputFile() (string, error) {
	return wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Select a video to compress",
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "Video Files", Pattern: "*.mp4;*.mov;*.mkv;*.avi;*.webm;*.flv;*.wmv;*.m4v"},
			{DisplayName: "All Files", Pattern: "*.*"},
		},
	})
}

// SelectOutputDir opens a native folder picker for the output location.
func (a *App) SelectOutputDir() (string, error) {
	return wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Choose output folder",
	})
}

// GetVideoInfo runs ffprobe on the given file and returns its metadata.
func (a *App) GetVideoInfo(path string) (*VideoInfo, error) {
	stat, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("cannot read file: %w", err)
	}

	cmd := exec.Command(ffprobeBinary(),
		"-v", "quiet",
		"-print_format", "json",
		"-show_format", "-show_streams",
		path,
	)
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe failed (is ffmpeg/ffprobe installed and on PATH?): %w", err)
	}

	var probe struct {
		Format struct {
			Duration string `json:"duration"`
			BitRate  string `json:"bit_rate"`
		} `json:"format"`
		Streams []struct {
			CodecType   string `json:"codec_type"`
			CodecName   string `json:"codec_name"`
			Width       int    `json:"width"`
			Height      int    `json:"height"`
			RFrameRate  string `json:"r_frame_rate"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &probe); err != nil {
		return nil, fmt.Errorf("failed to parse ffprobe output: %w", err)
	}

	info := &VideoInfo{
		Path:      path,
		Name:      filepath.Base(path),
		SizeBytes: stat.Size(),
	}
	if d, err := strconv.ParseFloat(probe.Format.Duration, 64); err == nil {
		info.DurationS = d
	}
	if br, err := strconv.Atoi(probe.Format.BitRate); err == nil {
		info.BitrateKbs = br / 1000
	}
	for _, s := range probe.Streams {
		switch s.CodecType {
		case "video":
			info.Width = s.Width
			info.Height = s.Height
			info.VideoCodec = s.CodecName
			info.FPS = parseFrameRate(s.RFrameRate)
		case "audio":
			info.AudioCodec = s.CodecName
		}
	}

	return info, nil
}

// parseFrameRate converts ffprobe's "num/den" frame rate (e.g. "30000/1001")
// into a float. Returns 0 on anything unparseable.
func parseFrameRate(s string) float64 {
	parts := strings.SplitN(s, "/", 2)
	if len(parts) != 2 {
		return 0
	}
	num, err1 := strconv.ParseFloat(parts[0], 64)
	den, err2 := strconv.ParseFloat(parts[1], 64)
	if err1 != nil || err2 != nil || den == 0 {
		return 0
	}
	return num / den
}

// CompressVideo runs ffmpeg with the given options, emitting "compress:progress"
// events (0-100) and a final "compress:done" / "compress:error" event.
func (a *App) CompressVideo(opts CompressOptions) (*CompressResult, error) {
	inStat, err := os.Stat(opts.InputPath)
	if err != nil {
		return nil, fmt.Errorf("input file not found: %w", err)
	}

	info, err := a.GetVideoInfo(opts.InputPath)
	if err != nil {
		return nil, err
	}
	totalSeconds := info.DurationS

	args := []string{"-y", "-i", opts.InputPath}

	vcodec := opts.VideoCodec
	if vcodec == "" {
		vcodec = "libx264"
	}
	args = append(args, "-c:v", vcodec)

	crf := opts.CRF
	if crf <= 0 {
		crf = 28
	}
	args = append(args, "-crf", strconv.Itoa(crf))

	preset := opts.Preset
	if preset == "" {
		preset = "medium"
	}
	switch vcodec {
	case "libx264", "libx265":
		args = append(args, "-preset", preset)
	case "libvpx-vp9":
		// VP9 only honors -crf in constant-quality mode when paired with -b:v 0;
		// otherwise it silently falls back to a default bitrate target.
		args = append(args, "-b:v", "0")
	}

	if opts.ScalePct > 0 && opts.ScalePct < 100 {
		// Even dimensions required by most codecs.
		filter := fmt.Sprintf("scale=trunc(iw*%d/100/2)*2:trunc(ih*%d/100/2)*2", opts.ScalePct, opts.ScalePct)
		args = append(args, "-vf", filter)
	}

	if opts.RemoveAudio {
		args = append(args, "-an")
	} else if vcodec == "libvpx-vp9" {
		// WebM containers only accept Vorbis/Opus audio, not AAC.
		args = append(args, "-c:a", "libopus", "-b:a", "128k")
	} else {
		args = append(args, "-c:a", "aac", "-b:a", "128k")
	}

	args = append(args, "-progress", "pipe:1", "-nostats", opts.OutputPath)

	cmd := exec.Command(ffmpegBinary(), args...)
	hideWindow(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderrBuf := &strings.Builder{}
	cmd.Stderr = stderrBuf

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	go a.streamProgress(stdout, totalSeconds)

	if err := cmd.Wait(); err != nil {
		wailsruntime.EventsEmit(a.ctx, "compress:error", stderrBuf.String())
		return nil, fmt.Errorf("ffmpeg exited with error: %w", err)
	}

	outStat, err := os.Stat(opts.OutputPath)
	if err != nil {
		return nil, fmt.Errorf("output file missing after compression: %w", err)
	}

	result := &CompressResult{
		OutputPath:      opts.OutputPath,
		InputSizeBytes:  inStat.Size(),
		OutputSizeBytes: outStat.Size(),
	}
	if inStat.Size() > 0 {
		result.SavedPercent = (1 - float64(outStat.Size())/float64(inStat.Size())) * 100
	}

	wailsruntime.EventsEmit(a.ctx, "compress:done", result)
	return result, nil
}

// streamProgress parses ffmpeg's `-progress pipe:1` key=value lines and
// emits a 0-100 "compress:progress" event to the frontend.
func (a *App) streamProgress(stdout interface{ Read([]byte) (int, error) }, totalSeconds float64) {
	buf := make([]byte, 4096)
	var pending strings.Builder
	for {
		n, err := stdout.Read(buf)
		if n > 0 {
			pending.Write(buf[:n])
			lines := strings.Split(pending.String(), "\n")
			pending.Reset()
			for i, line := range lines {
				if i == len(lines)-1 {
					pending.WriteString(line)
					continue
				}
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "out_time_ms=") {
					if totalSeconds <= 0 {
						continue
					}
					val := strings.TrimPrefix(line, "out_time_ms=")
					us, convErr := strconv.ParseInt(val, 10, 64)
					if convErr != nil {
						continue
					}
					elapsed := float64(us) / 1_000_000.0
					pct := (elapsed / totalSeconds) * 100
					if pct > 100 {
						pct = 100
					}
					if pct < 0 {
						pct = 0
					}
					wailsruntime.EventsEmit(a.ctx, "compress:progress", pct)
				}
			}
		}
		if err != nil {
			return
		}
	}
}

// OpenInFileManager reveals the given file in the OS file explorer.
func (a *App) OpenInFileManager(path string) error {
	dir := filepath.Dir(path)
	var cmd *exec.Cmd
	switch goruntime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", "/select,", path)
	case "darwin":
		cmd = exec.Command("open", "-R", path)
	default:
		cmd = exec.Command("xdg-open", dir)
	}
	return cmd.Start()
}
