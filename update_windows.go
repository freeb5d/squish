//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// installUpdate replaces the running exe with the downloaded one. Windows
// keeps a running exe's file locked, so we can't overwrite it directly:
// instead we spawn a small batch script that waits for this process to
// exit, moves the new exe into place, relaunches it, and deletes itself --
// then we quit, which lets the waiting script proceed.
func (a *App) installUpdate(downloadedPath, assetName string) error {
	exePath, err := os.Executable()
	if err != nil {
		return err
	}
	pid := os.Getpid()
	batPath := filepath.Join(filepath.Dir(downloadedPath), "squish-update.bat")

	script := fmt.Sprintf(`@echo off
:wait
tasklist /FI "PID eq %d" 2>NUL | find "%d" >NUL
if not errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto wait
)
move /y "%s" "%s" >nul
start "" "%s"
del "%%~f0"
`, pid, pid, downloadedPath, exePath, exePath)

	if err := os.WriteFile(batPath, []byte(script), 0o644); err != nil {
		return err
	}

	cmd := exec.Command("cmd", "/C", batPath)
	hideWindow(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}

	wailsruntime.EventsEmit(a.ctx, "update:installing", nil)
	go wailsruntime.Quit(a.ctx)
	return nil
}
