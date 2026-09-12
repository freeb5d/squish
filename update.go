package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// AppInfo is static metadata shown in the UI footer.
type AppInfo struct {
	Version   string `json:"version"`
	GithubURL string `json:"githubUrl"`
}

// UpdateInfo describes the result of checking GitHub for a newer release.
type UpdateInfo struct {
	Available      bool   `json:"available"`
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	ReleaseURL     string `json:"releaseUrl"`
	AssetAvailable bool   `json:"assetAvailable"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

type githubRelease struct {
	TagName string        `json:"tag_name"`
	HTMLURL string        `json:"html_url"`
	Assets  []githubAsset `json:"assets"`
}

// GetAppInfo returns static app metadata for the UI footer.
func (a *App) GetAppInfo() AppInfo {
	return AppInfo{
		Version:   AppVersion,
		GithubURL: GithubURL,
	}
}

func fetchLatestRelease() (*githubRelease, error) {
	client := &http.Client{Timeout: 8 * time.Second}
	req, err := http.NewRequest("GET", "https://api.github.com/repos/"+GithubRepo+"/releases/latest", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github returned %s", resp.Status)
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, err
	}
	return &release, nil
}

// assetNameForPlatform returns the release asset filename this build's
// CI workflow publishes for the running OS (see .github/workflows/build.yml).
func assetNameForPlatform() string {
	switch goruntime.GOOS {
	case "windows":
		return "squish-windows-amd64.exe"
	case "darwin":
		return "squish-macos-universal.zip"
	default:
		return "squish-linux-amd64"
	}
}

func findAsset(release *githubRelease, name string) *githubAsset {
	for i := range release.Assets {
		if release.Assets[i].Name == name {
			return &release.Assets[i]
		}
	}
	return nil
}

// CheckForUpdates queries the GitHub API for the latest release and reports
// whether it's newer than the running version. Network failures are
// returned as a non-error "not available" result so the UI can stay quiet.
func (a *App) CheckForUpdates() UpdateInfo {
	result := UpdateInfo{CurrentVersion: AppVersion}

	release, err := fetchLatestRelease()
	if err != nil {
		return result
	}

	latest := strings.TrimPrefix(release.TagName, "v")
	result.LatestVersion = latest
	result.ReleaseURL = release.HTMLURL
	result.Available = isNewerVersion(latest, AppVersion)
	result.AssetAvailable = findAsset(release, assetNameForPlatform()) != nil
	return result
}

// OpenReleasePage opens the project's GitHub page (or a specific release
// URL previously returned by CheckForUpdates) in the user's default
// browser. Restricted to github.com URLs for this repo.
func (a *App) OpenReleasePage(url string) error {
	if url == "" || !strings.HasPrefix(url, "https://github.com/"+GithubRepo) {
		url = GithubURL
	}
	wailsruntime.BrowserOpenURL(a.ctx, url)
	return nil
}

// isNewerVersion does a simple numeric dotted-version comparison
// ("1.2.0" > "1.1.9"). Non-numeric parts are treated as 0.
func isNewerVersion(latest, current string) bool {
	lp := strings.Split(latest, ".")
	cp := strings.Split(current, ".")
	for i := 0; i < len(lp) || i < len(cp); i++ {
		var l, c int
		if i < len(lp) {
			l, _ = strconv.Atoi(lp[i])
		}
		if i < len(cp) {
			c, _ = strconv.Atoi(cp[i])
		}
		if l != c {
			return l > c
		}
	}
	return false
}

// progressReader wraps an io.Reader, emitting "update:progress" events
// (throttled) as bytes are consumed, with a rolling download speed.
type progressReader struct {
	io.Reader
	total     int64
	read      int64
	lastEmit  time.Time
	lastBytes int64
	emitCtx   *App
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.Reader.Read(b)
	p.read += int64(n)

	now := time.Now()
	elapsed := now.Sub(p.lastEmit)
	isDone := err == io.EOF
	if elapsed >= 200*time.Millisecond || isDone {
		var speed float64
		if secs := elapsed.Seconds(); secs > 0 {
			speed = float64(p.read-p.lastBytes) / secs
		}
		pct := 0.0
		if p.total > 0 {
			pct = float64(p.read) / float64(p.total) * 100
		}
		wailsruntime.EventsEmit(p.emitCtx.ctx, "update:progress", map[string]interface{}{
			"downloadedBytes": p.read,
			"totalBytes":      p.total,
			"percent":         pct,
			"bytesPerSecond":  speed,
		})
		p.lastEmit = now
		p.lastBytes = p.read
	}
	return n, err
}

// DownloadUpdate fetches the latest release's platform asset, reporting
// progress via "update:progress" events, then hands off to the
// platform-specific installUpdate to replace the running binary and
// relaunch. The app quits itself once the replacement is underway.
func (a *App) DownloadUpdate() error {
	release, err := fetchLatestRelease()
	if err != nil {
		return fmt.Errorf("couldn't reach GitHub: %w", err)
	}

	assetName := assetNameForPlatform()
	asset := findAsset(release, assetName)
	if asset == nil {
		return fmt.Errorf("no update asset published for this platform (%s)", assetName)
	}

	client := &http.Client{}
	resp, err := client.Get(asset.BrowserDownloadURL)
	if err != nil {
		return fmt.Errorf("download failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: %s", resp.Status)
	}

	tempDir := filepath.Join(os.TempDir(), "squish-update")
	if err := os.MkdirAll(tempDir, 0o755); err != nil {
		return err
	}
	tempFile := filepath.Join(tempDir, assetName)

	out, err := os.Create(tempFile)
	if err != nil {
		return err
	}

	pr := &progressReader{Reader: resp.Body, total: resp.ContentLength, lastEmit: time.Now(), emitCtx: a}
	_, copyErr := io.Copy(out, pr)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}

	wailsruntime.EventsEmit(a.ctx, "update:progress", map[string]interface{}{
		"downloadedBytes": pr.read,
		"totalBytes":      pr.total,
		"percent":         100.0,
		"bytesPerSecond":  0.0,
	})

	return a.installUpdate(tempFile, assetName)
}
