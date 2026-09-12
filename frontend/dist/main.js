const themeToggle = document.getElementById("theme-toggle");
const iconSun = document.getElementById("icon-sun");
const iconMoon = document.getElementById("icon-moon");
const githubLinkBtn = document.getElementById("github-link");
const languageButton = document.getElementById("language-button");
const languageCurrent = document.getElementById("language-current");
const languageList = document.getElementById("language-list");

const aboutBtn = document.getElementById("about-btn");
const aboutUpdateDot = document.getElementById("about-update-dot");
const aboutOverlay = document.getElementById("about-overlay");
const aboutClose = document.getElementById("about-close");
const aboutVersionEl = document.getElementById("about-version");
const aboutGithubLink = document.getElementById("about-github-link");
const updateIdleRow = document.getElementById("update-idle-row");
const updateStatusText = document.getElementById("update-status-text");
const checkUpdateBtn = document.getElementById("check-update-btn");
const updateAvailableRow = document.getElementById("update-available-row");
const updateAvailableText = document.getElementById("update-available-text");
const updateNowBtn = document.getElementById("update-now-btn");
const updateProgressRow = document.getElementById("update-progress-row");
const updateProgressLabel = document.getElementById("update-progress-label");
const updateProgressFill = document.getElementById("update-progress-fill");
const updateProgressPct = document.getElementById("update-progress-pct");
const updateProgressSpeed = document.getElementById("update-progress-speed");
const updateErrorText = document.getElementById("update-error-text");

let githubUrl = "";
let currentLang = "en";
let appVersionNumber = "";

function applyLanguage(lang) {
  if (!I18N[lang]) lang = "en";
  currentLang = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir = I18N[lang].dir;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(lang, key);
  });
  if (appVersionNumber) {
    aboutVersionEl.textContent = `v${appVersionNumber}`;
  }
  try {
    localStorage.setItem("squish-lang", lang);
  } catch (e) {
    /* ignore */
  }
  languageCurrent.textContent = lang.toUpperCase();
  languageList.querySelectorAll(".lang-option").forEach((el) => {
    el.classList.toggle("active", el.dataset.lang === lang);
  });
  if (typeof updateEstimate === "function") updateEstimate();
  if (typeof refreshResultSummary === "function") refreshResultSummary();
  if (typeof renderUpdateRows === "function") renderUpdateRows();
}

function closeLanguageList() {
  languageList.classList.add("hidden");
  languageButton.setAttribute("aria-expanded", "false");
}

function initLanguage() {
  SUPPORTED_LANGS.forEach((code) => {
    const li = document.createElement("li");
    li.className = "lang-option";
    li.dataset.lang = code;
    li.setAttribute("role", "option");
    li.innerHTML =
      '<span>' + I18N[code].name + '</span>' +
      '<svg class="check" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
    li.addEventListener("click", () => {
      applyLanguage(code);
      closeLanguageList();
    });
    languageList.appendChild(li);
  });
  applyLanguage(detectInitialLang());
}

languageButton.addEventListener("click", (e) => {
  e.stopPropagation();
  const isHidden = languageList.classList.contains("hidden");
  if (isHidden) {
    languageList.classList.remove("hidden");
    languageButton.setAttribute("aria-expanded", "true");
  } else {
    closeLanguageList();
  }
});

document.addEventListener("click", (e) => {
  if (!languageList.classList.contains("hidden") && !e.target.closest(".lang-menu")) {
    closeLanguageList();
  }
});

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  // Icon shows what clicking will switch you TO, matching the old glyph
  // convention: sun visible in dark mode (click for light), moon visible
  // in light mode (click for dark).
  iconSun.classList.toggle("hidden", theme !== "dark");
  iconMoon.classList.toggle("hidden", theme === "dark");
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

let latestUpdateInfo = null;
let updateInProgress = false;

async function initFooterAndUpdates() {
  try {
    const info = await window.go.main.App.GetAppInfo();
    githubUrl = info.githubUrl;
    appVersionNumber = info.version;
    aboutVersionEl.textContent = `v${info.version}`;
  } catch (e) {
    /* backend not ready yet, ignore */
  }

  try {
    const update = await window.go.main.App.CheckForUpdates();
    applyUpdateInfo(update);
  } catch (e) {
    /* offline or GitHub unreachable, stay quiet */
  }
}

function applyUpdateInfo(update) {
  latestUpdateInfo = update;
  const show = update.available && update.assetAvailable;
  aboutUpdateDot.classList.toggle("hidden", !show);
  renderUpdateRows();
}

function renderUpdateRows() {
  if (updateInProgress) return;
  updateErrorText.classList.add("hidden");
  updateProgressRow.classList.add("hidden");

  if (latestUpdateInfo && latestUpdateInfo.available && latestUpdateInfo.assetAvailable) {
    updateIdleRow.classList.add("hidden");
    updateAvailableRow.classList.remove("hidden");
    updateAvailableText.textContent = t(currentLang, "updateAvailable", {
      latest: latestUpdateInfo.latestVersion,
      current: latestUpdateInfo.currentVersion,
    });
  } else {
    updateAvailableRow.classList.add("hidden");
    updateIdleRow.classList.remove("hidden");
    updateStatusText.textContent = t(currentLang, "upToDate");
  }
}

function openAboutModal() {
  aboutOverlay.classList.remove("hidden");
  renderUpdateRows();
}

function closeAboutModal() {
  aboutOverlay.classList.add("hidden");
}

aboutBtn.addEventListener("click", openAboutModal);
aboutClose.addEventListener("click", closeAboutModal);
aboutOverlay.addEventListener("click", (e) => {
  if (e.target === aboutOverlay) closeAboutModal();
});

githubLinkBtn.addEventListener("click", async () => {
  try {
    await window.go.main.App.OpenReleasePage(githubUrl);
  } catch (e) {
    /* ignore */
  }
});

aboutGithubLink.addEventListener("click", async () => {
  try {
    await window.go.main.App.OpenReleasePage(githubUrl);
  } catch (e) {
    /* ignore */
  }
});

checkUpdateBtn.addEventListener("click", async () => {
  updateStatusText.textContent = t(currentLang, "checkingForUpdates");
  try {
    const update = await window.go.main.App.CheckForUpdates();
    applyUpdateInfo(update);
  } catch (e) {
    updateStatusText.textContent = t(currentLang, "upToDate");
  }
});

updateNowBtn.addEventListener("click", async () => {
  updateInProgress = true;
  updateAvailableRow.classList.add("hidden");
  updateIdleRow.classList.add("hidden");
  updateErrorText.classList.add("hidden");
  updateProgressRow.classList.remove("hidden");
  updateProgressLabel.textContent = t(currentLang, "downloadingUpdate");
  updateProgressFill.style.width = "0%";
  updateProgressPct.textContent = "0%";
  updateProgressSpeed.textContent = "";

  try {
    await window.go.main.App.DownloadUpdate();
    // On success the app quits itself to relaunch with the new version;
    // if we're still here after a moment, something silently didn't
    // trigger the restart, but there's nothing more to do from here.
  } catch (e) {
    updateInProgress = false;
    updateProgressRow.classList.add("hidden");
    updateErrorText.textContent = t(currentLang, "updateFailed", { error: String(e) });
    updateErrorText.classList.remove("hidden");
    renderUpdateRows();
  }
});

if (window.runtime) {
  window.runtime.EventsOn("update:progress", (p) => {
    const pct = Math.max(0, Math.min(100, p.percent || 0));
    updateProgressFill.style.width = pct.toFixed(0) + "%";
    updateProgressPct.textContent = pct.toFixed(0) + "%";
    if (p.bytesPerSecond > 0) {
      updateProgressSpeed.textContent = t(currentLang, "speedPerSecond", {
        speed: formatBytes(p.bytesPerSecond),
      });
    }
  });
  window.runtime.EventsOn("update:installing", () => {
    updateProgressLabel.textContent = t(currentLang, "installingRestarting");
    updateProgressSpeed.textContent = "";
  });
}

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
let lastCompressResult = null;
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
  if (crf <= 20) return t(currentLang, "qualityExcellent");
  if (crf <= 25) return t(currentLang, "qualityHigh");
  if (crf <= 30) return t(currentLang, "qualityGood");
  if (crf <= 35) return t(currentLang, "qualityMedium");
  return t(currentLang, "qualityLow");
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

  let sizeText = `${t(currentLang, "estimateSizePrefix")} ~${formatBytes(estimatedBytes)}`;
  if (pctOfOriginal !== null) {
    sizeText += ` (~${pctOfOriginal.toFixed(0)}% ${t(currentLang, "estimateOfOriginal")})`;
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
    dropText.textContent = t(currentLang, "selectedLabel");
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
    lastCompressResult = result;
    progressSection.classList.add("hidden");
    resultSection.classList.remove("hidden");
    refreshResultSummary();
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
  lastCompressResult = null;
  currentVideoInfo = null;
  dropText.textContent = t(currentLang, "dropText");
  fileInfo.classList.add("hidden");
  settings.classList.add("hidden");
  resultSection.classList.add("hidden");
  clearError();
});

function refreshResultSummary() {
  if (!lastCompressResult) return;
  resultSummary.textContent = t(currentLang, "resultSummary", {
    from: formatBytes(lastCompressResult.inputSizeBytes),
    to: formatBytes(lastCompressResult.outputSizeBytes),
    pct: lastCompressResult.savedPercent.toFixed(1),
  });
}

if (window.runtime) {
  window.runtime.EventsOn("compress:progress", (pct) => {
    const clamped = Math.max(0, Math.min(100, pct));
    progressFill.style.width = clamped.toFixed(0) + "%";
    progressText.textContent = clamped.toFixed(0) + "%";
  });
}

initLanguage();
