const themeToggle = document.getElementById("theme-toggle");
const themeIcon = document.getElementById("theme-icon");
const appVersionEl = document.getElementById("app-version");
const githubLinkBtn = document.getElementById("github-link");
const updateBanner = document.getElementById("update-banner");
const updateText = document.getElementById("update-text");
const updateViewBtn = document.getElementById("update-view-btn");
const updateDismissBtn = document.getElementById("update-dismiss-btn");

let githubUrl = "";
let latestReleaseUrl = "";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeIcon.textContent = theme === "dark" ? "☀" : "☽";
  try {
    localStorage.setItem("squish-theme", theme);
  } catch (e) {
    /* localStorage unavailable, ignore */
  }
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem("squish-theme");
  } catch (e) {
    /* ignore */
  }
  if (saved === "dark" || saved === "light") {
    applyTheme(saved);
    return;
  }
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "dark" : "light");
}

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

initTheme();

async function initFooterAndUpdates() {
  try {
    const info = await window.go.main.App.GetAppInfo();
    githubUrl = info.githubUrl;
    appVersionEl.textContent = `Squish v${info.version}`;
  } catch (e) {
    /* backend not ready yet, ignore */
  }

  try {
    const update = await window.go.main.App.CheckForUpdates();
    if (update.available) {
      latestReleaseUrl = update.releaseUrl;
      updateText.textContent = `Update available: v${update.latestVersion} (you're on v${update.currentVersion})`;
      updateBanner.classList.remove("hidden");
    }
  } catch (e) {
    /* offline or GitHub unreachable, stay quiet */
  }
}

githubLinkBtn.addEventListener("click", async () => {
  try {
    await window.go.main.App.OpenReleasePage(githubUrl);
  } catch (e) {
    /* ignore */
  }
});

updateViewBtn.addEventListener("click", async () => {
  try {
    await window.go.main.App.OpenReleasePage(latestReleaseUrl);
  } catch (e) {
    /* ignore */
  }
});

updateDismissBtn.addEventListener("click", () => {
  updateBanner.classList.add("hidden");
});

initFooterAndUpdates();

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
const estimateSizeEl = document.getElementById("estimate-size");
const estimateQualityEl = document.getElementById("estimate-quality");

let selectedPath = null;
let outputDir = null;
let lastOutputPath = null;
let currentVideoInfo = null;

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

// Rough bits-per-pixel-per-frame curve for libx264 at various CRF values,
// derived from commonly-cited empirical CRF/bpp guides. libx265 and VP9
// are noticeably more efficient at the same CRF number, so their bytes
// are scaled down from this baseline. This is a ballpark estimate, not a
// guarantee -- actual output size still depends heavily on scene content.
const BPP_CURVE = [
  { crf: 16, bpp: 0.160 },
  { crf: 18, bpp: 0.130 },
  { crf: 20, bpp: 0.100 },
  { crf: 23, bpp: 0.070 },
  { crf: 26, bpp: 0.050 },
  { crf: 28, bpp: 0.038 },
  { crf: 30, bpp: 0.030 },
  { crf: 32, bpp: 0.024 },
  { crf: 35, bpp: 0.017 },
  { crf: 38, bpp: 0.012 },
  { crf: 40, bpp: 0.010 },
];

const CODEC_EFFICIENCY = {
  libx264: 1.0,
  libx265: 0.6,
  "libvpx-vp9": 0.65,
};

function bppForCRF(crf) {
  if (crf <= BPP_CURVE[0].crf) return BPP_CURVE[0].bpp;
  const last = BPP_CURVE[BPP_CURVE.length - 1];
  if (crf >= last.crf) return last.bpp;
  for (let i = 0; i < BPP_CURVE.length - 1; i++) {
    const a = BPP_CURVE[i];
    const b = BPP_CURVE[i + 1];
    if (crf >= a.crf && crf <= b.crf) {
      const t = (crf - a.crf) / (b.crf - a.crf);
      return a.bpp + t * (b.bpp - a.bpp);
    }
  }
  return last.bpp;
}

function qualityLabelForCRF(crf) {
  if (crf <= 20) return "Excellent quality (near-lossless)";
  if (crf <= 25) return "High quality";
  if (crf <= 30) return "Good quality";
  if (crf <= 35) return "Medium quality";
  return "Low quality (visible artifacts)";
}

function updateEstimate() {
  if (!currentVideoInfo) return;

  const crf = parseInt(qualityInput.value, 10);
  const scalePct = parseInt(scaleSelect.value, 10);
  const { codec } = codecForFormat(formatSelect.value);
  const removeAudio = removeAudioCheckbox.checked;

  const fps = currentVideoInfo.fps > 0 ? currentVideoInfo.fps : 30;
  const scaleFactor = scalePct / 100;
  const width = currentVideoInfo.width * scaleFactor;
  const height = currentVideoInfo.height * scaleFactor;
  const duration = currentVideoInfo.durationSeconds;

  const bpp = bppForCRF(crf) * (CODEC_EFFICIENCY[codec] ?? 1.0);
  const videoBitrateBps = bpp * width * height * fps;
  const videoBytes = (videoBitrateBps * duration) / 8;

  const audioBytes = removeAudio ? 0 : (128000 * duration) / 8;

  const estimatedBytes = videoBytes + audioBytes;
  const pctOfOriginal = currentVideoInfo.sizeBytes > 0
    ? (estimatedBytes / currentVideoInfo.sizeBytes) * 100
    : null;

  let sizeText = `Estimated size: ~${formatBytes(estimatedBytes)}`;
  if (pctOfOriginal !== null) {
    sizeText += ` (~${pctOfOriginal.toFixed(0)}% of original)`;
  }
  estimateSizeEl.textContent = sizeText;
  estimateQualityEl.textContent = qualityLabelForCRF(crf);
}

qualityInput.addEventListener("input", () => {
  qualityValue.textContent = qualityInput.value;
  updateEstimate();
});
formatSelect.addEventListener("change", updateEstimate);
scaleSelect.addEventListener("change", updateEstimate);
removeAudioCheckbox.addEventListener("change", updateEstimate);

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
    currentVideoInfo = info;
    const durationMin = Math.floor(info.durationSeconds / 60);
    const durationSec = Math.round(info.durationSeconds % 60);
    dropText.textContent = "Selected:";
    fileInfo.textContent = `${info.name} — ${formatBytes(info.sizeBytes)} — ${info.width}x${info.height} — ${durationMin}m${durationSec}s — ${info.videoCodec}`;
    fileInfo.classList.remove("hidden");
    settings.classList.remove("hidden");
    resultSection.classList.add("hidden");
    progressSection.classList.add("hidden");
    updateEstimate();
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
  currentVideoInfo = null;
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
