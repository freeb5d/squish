//go:build linux

package main

import _ "embed"

//go:embed resources/ffmpeg/linux/ffmpeg
var embeddedFFmpeg []byte

//go:embed resources/ffmpeg/linux/ffprobe
var embeddedFFprobe []byte

const embeddedBinExt = ""
