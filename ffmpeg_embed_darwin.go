//go:build darwin

package main

import _ "embed"

//go:embed resources/ffmpeg/darwin/ffmpeg
var embeddedFFmpeg []byte

//go:embed resources/ffmpeg/darwin/ffprobe
var embeddedFFprobe []byte

const embeddedBinExt = ""
