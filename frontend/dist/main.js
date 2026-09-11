const dropZone = document.getElementById("drop-zone");
const dropText = document.getElementById("drop-text");
const fileInfo = document.getElementById("file-info");
const settings = document.getElementById("settings");
const formatSelect = document.getElementById("format");
const qualityInput = document.getElementById("quality");
const qualityValue = document.getElementById("quality-value");
const scaleSelect = document.getElementById("scale");
const removeAudioCheckbox = document.getElementById("remove-audio");
const compressBtn = document.getElementById("compress-btn");
const progressSection = document.getElementById("progress-section");
const progressFill = document.getElementById("progress-fill");
const progressText = document.getElementById("progress-text");
const resultSection = document.getElementById("result-section");
const resultSummary = document.getElementById("result-summary");
const openFolderBtn = document.getElementById("open-folder-btn");
const resetBtn = document.getElementById("reset-btn");
const errorText = document.getElementById("error-text");

let selectedPath = null;
let outputDir = null;
let lastOutputPath = null;

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB"];
  let val = bytes;
  let i = -1;
  do {
    val /= 1024;
    i++;
  } while (val >= 1024 && i < units.length - 1);
  return val.toFixed(1) + " " + units[i];
}

function showError(msg) {
  errorText.textContent = msg;
  errorText.classList.remove("hidden");
}

function clearError() {
  errorText.classList.add("hidden");
  errorText.textContent = "";
}

qualityInput.addEventListener("input", () => {
  qualityValue.textContent = qualityInput.value;
});

dropZone.addEventListener("click", async () => {
  clearError();
  try {
    const path = await window.go.main.App.SelectInputFile();
    if (path) await selectFile(path);
  } catch (e) {
    showError(String(e));
  }
});

["dragover", "dragenter"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
  });
});

dropZone.addEventListener("drop", async (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file && file.path) {
    await selectFile(file.path);
  }
});

async function selectFile(path) {
  clearError();
  selectedPath = path;
  try {
    const info = await window.go.main.App.GetVideoInfo(path);
    const durationMin = Math.floor(info.durationSeconds / 60);
    const durationSec = Math.round(info.durationSeconds % 60);
    dropText.textContent = "Selected:";
    fileInfo.textContent = `${info.name} — ${formatBytes(info.sizeBytes)} — ${info.width}x${info.height} — ${durationMin}m${durationSec}s — ${info.videoCodec}`;
    fileInfo.classList.remove("hidden");
    settings.classList.remove("hidden");
    resultSection.classList.add("hidden");
    progressSection.classList.add("hidden");
  } catch (e) {
    showError(String(e));
  }
}

function codecForFormat(format) {
  switch (format) {
    case "mp4-h265":
      return { codec: "libx265", ext: "mp4" };
    case "webm":
      return { codec: "libvpx-vp9", ext: "webm" };
    default:
      return { codec: "libx264", ext: "mp4" };
  }
}

compressBtn.addEventListener("click", async () => {
  if (!selectedPath) return;
  clearError();

  try {
    if (!outputDir) {
      outputDir = await window.go.main.App.SelectOutputDir();
      if (!outputDir) return;
    }
  } catch (e) {
    showError(String(e));
    return;
  }

  const { codec, ext } = codecForFormat(formatSelect.value);
  const baseName = selectedPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
  const sep = outputDir.includes("\\") ? "\\" : "/";
  const outputPath = `${outputDir}${sep}${baseName}-compressed.${ext}`;

  const opts = {
    inputPath: selectedPath,
    outputPath,
    format: ext,
    videoCodec: codec,
    crf: parseInt(qualityInput.value, 10),
    preset: "medium",
    scalePct: parseInt(scaleSelect.value, 10),
    removeAudio: removeAudioCheckbox.checked,
  };

  settings.classList.add("hidden");
  progressSection.classList.remove("hidden");
  progressFill.style.width = "0%";
  progressText.textContent = "0%";

  try {
    const result = await window.go.main.App.CompressVideo(opts);
    lastOutputPath = result.outputPath;
    progressSection.classList.add("hidden");
    resultSection.classList.remove("hidden");
    resultSummary.textContent =
      `${formatBytes(result.inputSizeBytes)} -> ${formatBytes(result.outputSizeBytes)} ` +
      `(${result.savedPercent.toFixed(1)}% smaller)`;
  } catch (e) {
    progressSection.classList.add("hidden");
    settings.classList.remove("hidden");
    showError(String(e));
  }
});

openFolderBtn.addEventListener("click", async () => {
  if (!lastOutputPath) return;
  try {
    await window.go.main.App.OpenInFileManager(lastOutputPath);
  } catch (e) {
    showError(String(e));
  }
});

resetBtn.addEventListener("click", () => {
  selectedPath = null;
  lastOutputPath = null;
  dropText.textContent = "Click to choose a video, or drag one here";
  fileInfo.classList.add("hidden");
  settings.classList.add("hidden");
  resultSection.classList.add("hidden");
  clearError();
});

if (window.runtime) {
  window.runtime.EventsOn("compress:progress", (pct) => {
    const clamped = Math.max(0, Math.min(100, pct));
    progressFill.style.width = clamped.toFixed(0) + "%";
    progressText.textContent = clamped.toFixed(0) + "%";
  });
}
