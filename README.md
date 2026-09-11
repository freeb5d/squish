# Squish

A tiny cross-platform desktop app for compressing videos, built with [Wails](https://wails.io) (Go backend) and FFmpeg.

## Features

- Pick a video (file dialog or drag & drop)
- See its resolution, duration, codec, and size before compressing
- Choose output format (MP4/H.264, MP4/H.265, WebM/VP9), quality (CRF), resolution scale, and whether to strip audio
- Live progress bar while FFmpeg runs
- Shows size saved, and can reveal the output file in your file manager

## How it works

Squish doesn't reimplement video codecs — like every tool in this space, it shells out to the `ffmpeg`/`ffprobe` binaries on your machine and wraps them in a native GUI. The Go backend (`app.go`) builds the ffmpeg command from your chosen settings, parses `-progress` output for the progress bar, and exposes everything to a small vanilla HTML/JS frontend via Wails bindings.

## Download

Prebuilt binaries for Windows, macOS, and Linux are attached to each [GitHub release](https://github.com/freeb5d/squish/releases). Pushing a tag like `v1.1.0` triggers CI (`.github/workflows/build.yml`) to build all three platforms and publish them automatically.

## Prerequisites

- [Go](https://go.dev/dl/) 1.21+
- [FFmpeg](https://ffmpeg.org/download.html) (`ffmpeg` and `ffprobe` on your `PATH`)
- [Wails CLI](https://wails.io/docs/gettingstarted/installation) v2: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`

## Run in dev mode

```bash
wails dev
```

## Build a binary

```bash
wails build
```

The compiled app is written to `build/bin/`.

## Project layout

```
main.go            entrypoint, Wails app config
app.go              backend logic: file dialogs, ffprobe/ffmpeg wrapper, progress events
frontend/dist/      static HTML/CSS/JS frontend (no build step required)
wails.json          Wails project config
```

## License

MIT
