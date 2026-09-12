package main

import (
	"os"
	"path/filepath"
	"sync"
)

// minBundledSize distinguishes a real embedded ffmpeg/ffprobe binary from
// the 0-byte placeholder files committed to the repo. Release builds have
// resources/ffmpeg/<os>/ populated with real binaries before `wails build`
// (see .github/workflows/build.yml); a plain local `go build` without that
// step falls back to whatever ffmpeg/ffprobe are on PATH.
const minBundledSize = 1 << 20 // 1MB

var (
	bundledOnce        sync.Once
	bundledFFmpegPath  string
	bundledFFprobePath string
)

// ensureBundledTools extracts the embedded ffmpeg/ffprobe binaries (if this
// build actually has them baked in) to a per-user cache directory on first
// use, so Squish runs without any separate ffmpeg install.
func ensureBundledTools() {
	bundledOnce.Do(func() {
		if len(embeddedFFmpeg) < minBundledSize || len(embeddedFFprobe) < minBundledSize {
			return
		}
		cacheDir, err := os.UserCacheDir()
		if err != nil {
			return
		}
		dir := filepath.Join(cacheDir, "squish", "bin")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return
		}
		ffmpegPath := filepath.Join(dir, "ffmpeg"+embeddedBinExt)
		ffprobePath := filepath.Join(dir, "ffprobe"+embeddedBinExt)
		if extractIfNeeded(ffmpegPath, embeddedFFmpeg) && extractIfNeeded(ffprobePath, embeddedFFprobe) {
			bundledFFmpegPath = ffmpegPath
			bundledFFprobePath = ffprobePath
		}
	})
}

// extractIfNeeded writes data to path unless a file matching data's size is
// already there (cheap "is this already extracted" check across launches --
// avoids rewriting ~150MB of binaries on every startup).
func extractIfNeeded(path string, data []byte) bool {
	if info, err := os.Stat(path); err == nil && info.Size() == int64(len(data)) {
		return true
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o755); err != nil {
		return false
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return false
	}
	return true
}
