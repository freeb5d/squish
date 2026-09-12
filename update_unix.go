//go:build !windows

package main

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"os/exec"
	goruntime "runtime"
	"strings"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// installUpdate replaces the running executable in place. Unix lets you
// overwrite/rename over a file that's currently executing -- the running
// process keeps using its already-open (now unlinked) inode until it exits
// -- so no quit-first choreography is needed before writing the new file,
// only before relaunching it.
func (a *App) installUpdate(downloadedPath, assetName string) error {
	exePath, err := os.Executable()
	if err != nil {
		return err
	}

	var newBinary []byte
	if goruntime.GOOS == "darwin" && strings.HasSuffix(assetName, ".zip") {
		// The macOS asset is a zipped Squish.app bundle; only the inner
		// Mach-O binary needs replacing, not the whole bundle.
		newBinary, err = extractZipEntrySuffix(downloadedPath, "Contents/MacOS/squish")
		if err != nil {
			return fmt.Errorf("couldn't read update archive: %w", err)
		}
	} else {
		newBinary, err = os.ReadFile(downloadedPath)
		if err != nil {
			return err
		}
	}

	tmp := exePath + ".update"
	if err := os.WriteFile(tmp, newBinary, 0o755); err != nil {
		return err
	}
	if err := os.Rename(tmp, exePath); err != nil {
		return err
	}

	wailsruntime.EventsEmit(a.ctx, "update:installing", nil)

	cmd := exec.Command(exePath)
	if err := cmd.Start(); err != nil {
		return err
	}
	go wailsruntime.Quit(a.ctx)
	return nil
}

// extractZipEntrySuffix returns the contents of the first file in the zip
// whose path ends with suffix.
func extractZipEntrySuffix(zipPath, suffix string) ([]byte, error) {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, err
	}
	defer r.Close()

	for _, f := range r.File {
		if strings.HasSuffix(f.Name, suffix) {
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()
			return io.ReadAll(rc)
		}
	}
	return nil, fmt.Errorf("no entry matching %q found in %s", suffix, zipPath)
}
