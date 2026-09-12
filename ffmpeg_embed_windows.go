//go:build windows

package main

import _ "embed"

//go:embed resources/ffmpeg/windows/ffmpeg.exe
var embeddedFFmpeg []byte

//go:embed resources/ffmpeg/windows/ffprobe.exe
var embeddedFFprobe []byte

const embeddedBinExt = ".exe"
