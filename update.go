package main

import (
	"encoding/json"
	"net/http"
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
}

type githubRelease struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
}

// GetAppInfo returns static app metadata for the UI footer.
func (a *App) GetAppInfo() AppInfo {
	return AppInfo{
		Version:   AppVersion,
		GithubURL: GithubURL,
	}
}

// CheckForUpdates queries the GitHub API for the latest release and reports
// whether it's newer than the running version. Network failures are
// returned as a non-error "not available" result so the UI can stay quiet.
func (a *App) CheckForUpdates() UpdateInfo {
	result := UpdateInfo{CurrentVersion: AppVersion}

	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequest("GET", "https://api.github.com/repos/"+GithubRepo+"/releases/latest", nil)
	if err != nil {
		return result
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := client.Do(req)
	if err != nil {
		return result
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return result
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return result
	}

	latest := strings.TrimPrefix(release.TagName, "v")
	result.LatestVersion = latest
	result.ReleaseURL = release.HTMLURL
	result.Available = isNewerVersion(latest, AppVersion)
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
