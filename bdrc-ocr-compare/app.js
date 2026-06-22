const SAMPLE_PDF_URL = "../藏文/天文历算学-本科教材 藏文40301698_部分.pdf";
const PDF_WORKER_URL = "./vendor/pdf.worker.min.js";
const CACHE_PREFIX = "bdrc-ocr-compare:v1:";

const els = {};
const state = {
  pdfDoc: null,
  pdfUrl: "",
  imageUrl: "",
  imageBlob: null,
  sourceName: "",
  sourceSize: 0,
  sourceMime: "",
  cacheKey: "",
  sourceType: "",
  pageNum: 1,
  pageCount: 0,
  ocrResults: new Map(),
  translationResults: new Map(),
  ocrView: "lines",
  renderToken: 0,
  thumbnailToken: 0,
  thumbnailObserver: null,
};

window.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  wireEvents();
  configurePdfJs();
  refreshControls();
  updateSummary();
  updateTranslationSummary();
  if (window.lucide) {
    window.lucide.createIcons();
  }
});

function cacheElements() {
  [
    "fileInput",
    "sampleButton",
    "endpointInput",
    "translateEndpointInput",
    "dpiInput",
    "pageInput",
    "pageTotal",
    "prevButton",
    "nextButton",
    "zoomInput",
    "checkOcrButton",
    "checkTranslateButton",
    "ocrButton",
    "downloadPageButton",
    "statusBar",
    "thumbnailList",
    "sourceTitle",
    "fileOcrStatus",
    "renderMeta",
    "pageViewport",
    "pdfCanvas",
    "imagePage",
    "emptyState",
    "ocrTitle",
    "ocrMeta",
    "copyButton",
    "clearButton",
    "downloadTextButton",
    "ocrViewSwitch",
    "lineViewButton",
    "textViewButton",
    "ocrLineCompare",
    "ocrText",
    "charCount",
    "recognizedCount",
    "translationTitle",
    "translationMeta",
    "translateButton",
    "copyTranslationButton",
    "clearTranslationButton",
    "downloadTranslationButton",
    "translationText",
    "translationCharCount",
    "translatedCount",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function wireEvents() {
  els.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file) {
      await loadFile(file);
    }
  });

  els.sampleButton.addEventListener("click", loadSamplePdf);
  els.prevButton.addEventListener("click", () => goToPage(state.pageNum - 1));
  els.nextButton.addEventListener("click", () => goToPage(state.pageNum + 1));

  els.pageInput.addEventListener("change", () => {
    goToPage(Number(els.pageInput.value));
  });
  els.pageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      goToPage(Number(els.pageInput.value));
    }
  });

  els.zoomInput.addEventListener("change", renderCurrentPage);
  els.checkOcrButton.addEventListener("click", checkOcrService);
  els.checkTranslateButton.addEventListener("click", checkTranslateService);
  els.ocrButton.addEventListener("click", runOcrForCurrentPage);
  els.downloadPageButton.addEventListener("click", downloadCurrentPageImage);
  els.copyButton.addEventListener("click", copyCurrentText);
  els.clearButton.addEventListener("click", clearCurrentText);
  els.downloadTextButton.addEventListener("click", downloadAllOcrText);
  els.lineViewButton.addEventListener("click", () => setOcrView("lines"));
  els.textViewButton.addEventListener("click", () => setOcrView("text"));
  els.translateButton.addEventListener("click", runTranslateForCurrentPage);
  els.copyTranslationButton.addEventListener("click", copyCurrentTranslation);
  els.clearTranslationButton.addEventListener("click", clearCurrentTranslation);
  els.downloadTranslationButton.addEventListener("click", downloadAllTranslationText);

  els.ocrText.addEventListener("input", () => {
    if (!state.pageCount) return;
    if (els.ocrText.value.trim()) {
      const existing = state.ocrResults.get(state.pageNum) || {};
      const textLines = els.ocrText.value.split("\n");
      const existingLines = existing.lines || extractOcrLines(existing.raw);
      const lines = existingLines.map((line, index) => ({
        ...line,
        text: textLines[index] ?? "",
      }));
      for (let index = existingLines.length; index < textLines.length; index += 1) {
        lines.push({ text: textLines[index], image: "", index });
      }
      state.ocrResults.set(state.pageNum, {
        ...existing,
        text: els.ocrText.value,
        lines,
        source: existing.source || "manual",
        updatedAt: new Date().toISOString(),
      });
    } else {
      state.ocrResults.delete(state.pageNum);
    }
    saveCachedResults();
    renderOcrLineComparison();
    updateSummary();
    updateThumbnailState();
  });

  els.translationText.addEventListener("input", () => {
    if (!state.pageCount) return;
    if (els.translationText.value.trim()) {
      const existing = state.translationResults.get(state.pageNum) || {};
      state.translationResults.set(state.pageNum, {
        ...existing,
        text: els.translationText.value,
        source: existing.source || "manual",
        updatedAt: new Date().toISOString(),
      });
    } else {
      state.translationResults.delete(state.pageNum);
    }
    saveCachedResults();
    updateTranslationSummary();
    updateThumbnailState();
  });

  window.addEventListener("resize", debounce(() => {
    if (state.pageCount && els.zoomInput.value === "fit") {
      renderCurrentPage();
    }
  }, 160));
}

function configurePdfJs() {
  if (!window.pdfjsLib) {
    setStatus("PDF.js 未加载，检查网络或换用本地依赖。", "error");
    return;
  }
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
}

async function loadSamplePdf() {
  try {
    setStatus("正在载入本地样本 PDF...", "warn");
    const response = await fetch(encodeURI(SAMPLE_PDF_URL));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const file = new File([blob], "天文历算学-本科教材 藏文40301698_部分.pdf", {
      type: "application/pdf",
    });
    await loadFile(file);
  } catch (error) {
    setStatus(`无法载入本地样本。请确认从项目根目录启动 HTTP 服务。${error.message}`, "error");
  }
}

async function loadFile(file) {
  resetDocumentState();
  state.sourceName = file.name;
  state.sourceSize = file.size || 0;
  state.sourceMime = file.type || "";
  state.cacheKey = makeCacheKey(file);

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    await loadPdf(file);
    return;
  }

  if (file.type.startsWith("image/")) {
    await loadImage(file);
    return;
  }

  setStatus("只支持 PDF 或图片文件。", "error");
}

async function loadPdf(file) {
  if (!window.pdfjsLib) {
    setStatus("PDF.js 未加载，无法解析 PDF。", "error");
    return;
  }

  state.pdfUrl = URL.createObjectURL(file);
  const task = window.pdfjsLib.getDocument({ url: state.pdfUrl });
  state.pdfDoc = await task.promise;
  state.sourceType = "pdf";
  state.pageNum = 1;
  state.pageCount = state.pdfDoc.numPages;

  els.sourceTitle.textContent = state.sourceName;
  els.ocrTitle.textContent = "第 1 页 OCR";
  const restored = restoreCachedResults();
  setStatus(
    restored
      ? `已载入 ${state.sourceName}，共 ${state.pageCount} 页，并恢复本地暂存的 OCR/译文。`
      : `已载入 ${state.sourceName}，共 ${state.pageCount} 页。`,
    "ok"
  );
  refreshControls();
  await renderCurrentPage();
  const loadedDoc = state.pdfDoc;
  scheduleIdleWork(() => {
    if (state.pdfDoc === loadedDoc) {
      buildPdfThumbnails();
    }
  });
}

async function loadImage(file) {
  state.sourceType = "image";
  state.imageBlob = file;
  state.imageUrl = URL.createObjectURL(file);
  state.pageNum = 1;
  state.pageCount = 1;

  await new Promise((resolve, reject) => {
    els.imagePage.onload = resolve;
    els.imagePage.onerror = reject;
    els.imagePage.src = state.imageUrl;
  });

  els.sourceTitle.textContent = state.sourceName;
  els.ocrTitle.textContent = "图片 OCR";
  const restored = restoreCachedResults();
  setStatus(
    restored
      ? `已载入图片 ${state.sourceName}，并恢复本地暂存的 OCR/译文。`
      : `已载入图片 ${state.sourceName}。`,
    "ok"
  );
  refreshControls();
  renderCurrentPage();
  buildImageThumbnail();
}

function resetDocumentState() {
  if (state.thumbnailObserver) {
    state.thumbnailObserver.disconnect();
    state.thumbnailObserver = null;
  }
  state.thumbnailToken += 1;

  if (state.pdfUrl) {
    URL.revokeObjectURL(state.pdfUrl);
  }
  if (state.imageUrl) {
    URL.revokeObjectURL(state.imageUrl);
  }

  state.pdfDoc = null;
  state.pdfUrl = "";
  state.imageUrl = "";
  state.imageBlob = null;
  state.sourceName = "";
  state.sourceSize = 0;
  state.sourceMime = "";
  state.cacheKey = "";
  state.sourceType = "";
  state.pageNum = 1;
  state.pageCount = 0;
  state.ocrResults.clear();
  state.translationResults.clear();
  state.renderToken += 1;

  els.thumbnailList.innerHTML = "";
  els.ocrText.value = "";
  els.translationText.value = "";
  els.imagePage.removeAttribute("src");
  els.pdfCanvas.style.display = "none";
  els.imagePage.style.display = "none";
  els.emptyState.style.display = "grid";
  els.sourceTitle.textContent = "未载入文件";
  updateFileOcrStatus();
  els.ocrTitle.textContent = "等待识别";
  els.translationTitle.textContent = "等待翻译";
  els.renderMeta.textContent = "0 页";
  els.ocrMeta.textContent = "未识别";
  els.translationMeta.textContent = "未翻译";
  refreshControls();
  updateSummary();
  updateTranslationSummary();
}

function makeCacheKey(file) {
  const type = file.type || "unknown";
  const size = file.size || 0;
  return `${CACHE_PREFIX}${encodeURIComponent(file.name)}:${size}:${encodeURIComponent(type)}`;
}

function restoreCachedResults() {
  if (!state.cacheKey || !state.pageCount) return false;

  try {
    const raw = window.localStorage.getItem(state.cacheKey);
    if (!raw) return false;

    const payload = JSON.parse(raw);
    if (payload.pageCount && payload.pageCount !== state.pageCount) {
      return false;
    }

    state.ocrResults.clear();
    state.translationResults.clear();

    for (const [page, result] of Object.entries(payload.ocrResults || {})) {
      const pageNum = Number(page);
      if (!isValidPageNumber(pageNum) || typeof result?.text !== "string") continue;
      state.ocrResults.set(pageNum, {
        text: result.text,
        source: result.source || "cache",
        updatedAt: result.updatedAt || payload.updatedAt || "",
      });
    }

    for (const [page, result] of Object.entries(payload.translationResults || {})) {
      const pageNum = Number(page);
      if (!isValidPageNumber(pageNum) || typeof result?.text !== "string") continue;
      state.translationResults.set(pageNum, {
        text: result.text,
        source: result.source || "cache",
        updatedAt: result.updatedAt || payload.updatedAt || "",
      });
    }

    updateSummary();
    updateTranslationSummary();
    return state.ocrResults.size > 0 || state.translationResults.size > 0;
  } catch (error) {
    console.warn("Failed to restore cached OCR state", error);
    return false;
  }
}

function saveCachedResults() {
  if (!state.cacheKey || !state.pageCount) return;

  try {
    const payload = {
      sourceName: state.sourceName,
      sourceSize: state.sourceSize,
      sourceMime: state.sourceMime,
      pageCount: state.pageCount,
      updatedAt: new Date().toISOString(),
      ocrResults: serializeResultMap(state.ocrResults),
      translationResults: serializeResultMap(state.translationResults),
    };
    window.localStorage.setItem(state.cacheKey, JSON.stringify(payload));
  } catch (error) {
    console.warn("Failed to save cached OCR state", error);
  }
}

function serializeResultMap(map) {
  const output = {};
  for (const [pageNum, result] of map.entries()) {
    const text = result?.text || "";
    if (!text.trim()) continue;
    output[pageNum] = {
      text,
      source: result.source || "manual",
      updatedAt: result.updatedAt || "",
    };
  }
  return output;
}

function isValidPageNumber(pageNum) {
  return Number.isInteger(pageNum) && pageNum >= 1 && pageNum <= state.pageCount;
}

async function renderCurrentPage() {
  if (!state.pageCount) {
    return;
  }

  if (state.sourceType === "image") {
    renderImagePage();
    return;
  }

  const token = ++state.renderToken;
  const page = await state.pdfDoc.getPage(state.pageNum);
  if (token !== state.renderToken) return;

  const baseViewport = page.getViewport({ scale: 1 });
  const requestedZoom = els.zoomInput.value;
  const availableWidth = Math.max(320, els.pageViewport.clientWidth - 40);
  const scale = requestedZoom === "fit"
    ? Math.min(availableWidth / baseViewport.width, 2.2)
    : Number(requestedZoom);

  const viewport = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;
  const canvas = els.pdfCanvas;
  const context = canvas.getContext("2d", { alpha: false });

  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, viewport.width, viewport.height);

  await page.render({ canvasContext: context, viewport }).promise;
  if (token !== state.renderToken) return;

  els.pdfCanvas.style.display = "block";
  els.imagePage.style.display = "none";
  els.emptyState.style.display = "none";
  els.renderMeta.textContent = `${state.pageNum} / ${state.pageCount}`;
  els.pageInput.value = String(state.pageNum);
  updateOcrPanelForPage();
  updateTranslationPanelForPage();
  updateThumbnailState();
  requestThumbnailRender(state.pageNum);
}

function renderImagePage() {
  els.pdfCanvas.style.display = "none";
  els.imagePage.style.display = "block";
  els.emptyState.style.display = "none";
  els.renderMeta.textContent = "1 / 1";
  els.pageInput.value = "1";
  updateOcrPanelForPage();
  updateTranslationPanelForPage();
  updateThumbnailState();
}

async function buildPdfThumbnails() {
  els.thumbnailList.innerHTML = "";
  if (state.thumbnailObserver) {
    state.thumbnailObserver.disconnect();
    state.thumbnailObserver = null;
  }

  const count = state.pageCount;
  const token = ++state.thumbnailToken;
  const hasObserver = setupThumbnailObserver(token);
  let nextPage = 1;
  let renderedFallbackBatch = false;

  const appendChunk = (deadline) => {
    if (!state.pdfDoc || token !== state.thumbnailToken) return;

    const fragment = document.createDocumentFragment();
    const newButtons = [];
    let appended = 0;

    while (
      nextPage <= count &&
      appended < 48 &&
      (!deadline || deadline.timeRemaining() > 4 || appended < 8)
    ) {
      const button = createThumbnailButton(nextPage);
      fragment.appendChild(button);
      newButtons.push(button);
      nextPage += 1;
      appended += 1;
    }

    els.thumbnailList.appendChild(fragment);

    if (hasObserver) {
      newButtons.forEach((button) => state.thumbnailObserver.observe(button));
    } else if (!renderedFallbackBatch) {
      renderInitialThumbnailBatch(token);
      renderedFallbackBatch = true;
    }

    updateThumbnailState();
    requestThumbnailRender(state.pageNum, token);

    if (nextPage <= count) {
      scheduleIdleWork(appendChunk);
    }
  };

  appendChunk();
}

function setupThumbnailObserver(token) {
  if (!("IntersectionObserver" in window)) {
    return false;
  }

  state.thumbnailObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const pageNum = Number(entry.target.dataset.page);
      requestThumbnailRender(pageNum, token);
      state.thumbnailObserver?.unobserve(entry.target);
    });
  }, {
    root: els.thumbnailList,
    rootMargin: "160px 0px",
    threshold: 0.01,
  });

  return true;
}

function createThumbnailButton(pageNum) {
  const button = document.createElement("button");
  button.className = "thumbnail-button";
  button.type = "button";
  button.dataset.page = String(pageNum);
  button.innerHTML = `<span class="thumbnail-placeholder">第 ${pageNum} 页</span><span>${pageNum}</span>`;
  button.addEventListener("click", () => goToPage(pageNum));
  return button;
}

function scheduleIdleWork(callback) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout: 500 });
  } else {
    window.setTimeout(() => callback(), 16);
  }
}

function renderInitialThumbnailBatch(token) {
  const start = Math.max(1, state.pageNum - 2);
  const end = Math.min(state.pageCount, state.pageNum + 6);
  for (let pageNum = start; pageNum <= end; pageNum += 1) {
    requestThumbnailRender(pageNum, token);
  }
}

function requestThumbnailRender(pageNum, token = state.thumbnailToken) {
  const button = els.thumbnailList.querySelector(`[data-page="${pageNum}"]`);
  if (!button || button.dataset.thumbRendered === "1" || button.dataset.thumbLoading === "1") {
    return;
  }

  const run = () => renderPdfThumbnail(pageNum, button, token);
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 900 });
  } else {
    window.setTimeout(run, 0);
  }
}

async function renderPdfThumbnail(pageNum, button, token) {
  if (!state.pdfDoc || token !== state.thumbnailToken) return;

  try {
    button.dataset.thumbLoading = "1";
    const page = await state.pdfDoc.getPage(pageNum);
    if (!button.isConnected || token !== state.thumbnailToken) return;

    const viewport = page.getViewport({ scale: 0.1 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    if (!button.isConnected || token !== state.thumbnailToken) return;

    button.querySelector("canvas")?.remove();
    button.querySelector(".thumbnail-placeholder")?.remove();
    button.prepend(canvas);
    button.dataset.thumbRendered = "1";
  } catch (error) {
    console.warn(`Failed to render thumbnail for page ${pageNum}`, error);
  } finally {
    delete button.dataset.thumbLoading;
  }
}

function buildImageThumbnail() {
  els.thumbnailList.innerHTML = "";
  const button = document.createElement("button");
  button.className = "thumbnail-button active";
  button.type = "button";
  button.dataset.page = "1";
  const img = document.createElement("img");
  img.src = state.imageUrl;
  img.alt = "图片缩略图";
  const span = document.createElement("span");
  span.textContent = "1";
  button.append(img, span);
  els.thumbnailList.appendChild(button);
}

async function goToPage(pageNum) {
  if (!state.pageCount) return;
  const nextPage = clamp(Math.trunc(pageNum), 1, state.pageCount);
  if (nextPage === state.pageNum) {
    els.pageInput.value = String(state.pageNum);
    return;
  }
  state.pageNum = nextPage;
  await renderCurrentPage();
  requestThumbnailRender(state.pageNum);
  refreshControls();
}

async function syncPageInputBeforeAction() {
  const typedPage = Number(els.pageInput.value);
  if (Number.isFinite(typedPage) && Math.trunc(typedPage) !== state.pageNum) {
    await goToPage(typedPage);
  }
}

async function runOcrForCurrentPage() {
  if (!state.pageCount) {
    setStatus("请先上传 PDF 或图片。", "warn");
    return;
  }

  await syncPageInputBeforeAction();

  const endpoint = els.endpointInput.value.trim();
  if (!endpoint) {
    setStatus("请填写 BDRC OCR 接口地址。", "warn");
    return;
  }

  try {
    setBusy(true);
    setStatus(`正在生成第 ${state.pageNum} 页 OCR 图片...`, "warn");
    const blob = await getCurrentPageImageBlob();
    const formData = new FormData();
    formData.append("file", blob, makePageImageName());
    formData.append("engine", "bdrc");
    formData.append("lang", "bo");
    formData.append("page", String(state.pageNum));
    formData.append("source_name", state.sourceName);

    setStatus("正在调用 BDRC OCR 接口...", "warn");
    const response = await fetch(endpoint, { method: "POST", body: formData });

    const parsed = await parseOcrResponse(response);
    if (!response.ok) {
      throw new Error(parsed.error || `HTTP ${response.status}`);
    }

    const text = parsed.text.trim();
    state.ocrResults.set(state.pageNum, {
      text,
      raw: parsed.raw,
      lines: extractOcrLines(parsed.raw),
      source: "bdrc",
      updatedAt: new Date().toISOString(),
    });
    saveCachedResults();
    els.ocrText.value = text;
    setOcrView("lines");
    setStatus(`第 ${state.pageNum} 页识别完成。`, "ok");
    updateOcrPanelForPage();
    updateSummary();
    updateThumbnailState();
  } catch (error) {
    setStatus(`BDRC OCR 调用失败：${formatNetworkError(error, endpoint)}`, "error");
  } finally {
    setBusy(false);
  }
}

async function checkOcrService() {
  const endpoint = els.endpointInput.value.trim();
  if (!endpoint) {
    setStatus("请填写 BDRC OCR 接口地址。", "warn");
    return;
  }

  const healthUrl = endpoint.replace(/\/ocr\/?$/, "/health");
  try {
    setStatus("正在检查本地 BDRC OCR 服务...", "warn");
    const response = await fetch(healthUrl, { method: "GET" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json().catch(() => ({}));
    const model = payload.model || "BDRC";
    setStatus(`BDRC OCR 服务可用，当前模型：${model}。`, "ok");
  } catch (error) {
    setStatus(`BDRC OCR 服务不可用：${formatNetworkError(error, healthUrl)}`, "error");
  }
}

async function checkTranslateService() {
  const endpoint = els.translateEndpointInput.value.trim();
  if (!endpoint) {
    setStatus("请填写藏译汉接口地址。", "warn");
    return;
  }

  const healthUrl = endpoint.replace(/\/translate\/?$/, "/health");
  try {
    setStatus("正在检查本地藏译汉服务...", "warn");
    const payload = await fetchTranslateHealth(endpoint);
    const model = payload.model || payload.engine || "translate";
    const status = payload.status || (payload.loaded ? "ready" : "unknown");
    if (payload.loaded || status === "ready") {
      setStatus(`藏译汉服务可用，当前模型：${model}。`, "ok");
    } else if (status === "loading") {
      setStatus(`藏译汉服务已启动，模型 ${model} 正在下载/加载。请稍后再点“检查翻译”。`, "warn");
    } else if (status === "error") {
      throw new Error(payload.error || "模型加载失败");
    } else {
      setStatus(`藏译汉服务已启动，但模型尚未就绪：${status}。`, "warn");
    }
  } catch (error) {
    setStatus(`藏译汉服务不可用：${formatNetworkError(error, healthUrl, "translate")}`, "error");
  }
}

async function fetchTranslateHealth(endpoint) {
  const healthUrl = endpoint.replace(/\/translate\/?$/, "/health");
  const response = await fetch(healthUrl, { method: "GET" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json().catch(() => ({}));
}

async function ensureTranslateReady(endpoint) {
  const payload = await fetchTranslateHealth(endpoint);
  const status = payload.status || (payload.loaded ? "ready" : "unknown");
  if (payload.loaded || status === "ready") {
    return true;
  }
  const model = payload.model || "translate";
  if (status === "loading") {
    setStatus(`藏译汉模型 ${model} 正在下载/加载，暂时不能翻译。请稍后点“检查翻译”。`, "warn");
    return false;
  }
  if (status === "error") {
    throw new Error(payload.error || "模型加载失败");
  }
  setStatus(`藏译汉模型尚未就绪：${status}。请先点“检查翻译”。`, "warn");
  return false;
}

async function runTranslateForCurrentPage() {
  if (!state.pageCount) {
    setStatus("请先上传 PDF 或图片。", "warn");
    return;
  }

  await syncPageInputBeforeAction();

  const endpoint = els.translateEndpointInput.value.trim();
  if (!endpoint) {
    setStatus("请填写藏译汉接口地址。", "warn");
    return;
  }

  const sourceText = (els.ocrText.value || "").trim();
  if (!sourceText) {
    setStatus("当前页还没有 OCR 藏文文本，无法翻译。", "warn");
    return;
  }

  try {
    setTranslateBusy(true);
    const ready = await ensureTranslateReady(endpoint);
    if (!ready) {
      return;
    }
    setStatus(`正在翻译第 ${state.pageNum} 页 OCR 文本...`, "warn");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: sourceText,
        source_text: sourceText,
        source_lang: "bo",
        target_lang: "zh",
        src_lang: "bod_Tibt",
        tgt_lang: "zho_Hans",
        page: state.pageNum,
        source_name: state.sourceName,
      }),
    });

    const parsed = await parseTranslationResponse(response);
    if (!response.ok) {
      throw new Error(parsed.error || `HTTP ${response.status}`);
    }

    const text = parsed.text.trim();
    state.translationResults.set(state.pageNum, {
      text,
      raw: parsed.raw,
      source: "api",
      updatedAt: new Date().toISOString(),
    });
    saveCachedResults();
    els.translationText.value = text;
    setStatus(`第 ${state.pageNum} 页藏译汉完成。`, "ok");
    updateTranslationPanelForPage();
    updateTranslationSummary();
    updateThumbnailState();
  } catch (error) {
    setStatus(`藏译汉调用失败：${formatNetworkError(error, endpoint, "translate")}`, "error");
  } finally {
    setTranslateBusy(false);
  }
}

async function parseOcrResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const raw = await response.json();
    return {
      raw,
      text: extractTextFromJson(raw),
      error: raw.error || raw.message || raw.detail,
    };
  }

  const text = await response.text();
  return { raw: text, text, error: response.ok ? "" : text };
}

async function parseTranslationResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const raw = await response.json();
    return {
      raw,
      text: extractTranslationFromJson(raw),
      error: raw.error || raw.message || raw.detail,
    };
  }

  const text = await response.text();
  return { raw: text, text, error: response.ok ? "" : text };
}

function extractTextFromJson(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;

  const direct = payload.text || payload.ocr_text || payload.ocrText || payload.result_text || payload.output;
  if (typeof direct === "string") return direct;

  if (payload.result) {
    const nested = extractTextFromJson(payload.result);
    if (nested) return nested;
  }

  const lines = payload.lines || payload.blocks || payload.items;
  if (Array.isArray(lines)) {
    const text = lines
      .map((line) => {
        if (typeof line === "string") return line;
        return line.text || line.content || line.value || "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }

  return JSON.stringify(payload, null, 2);
}

function extractOcrLines(payload) {
  if (!payload || typeof payload === "string") return [];
  const candidates = payload.lines || payload.blocks || payload.items;
  if (!Array.isArray(candidates)) return [];

  return candidates
    .map((line, index) => {
      if (typeof line === "string") {
        return { text: line, image: "", index };
      }
      return {
        text: line?.text || line?.content || line?.value || "",
        image: line?.image || line?.image_url || line?.imageUrl || "",
        index,
      };
    })
    .filter((line) => line.text || line.image);
}

function extractTranslationFromJson(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;

  const direct = (
    payload.translation ||
    payload.translated_text ||
    payload.translatedText ||
    payload.target_text ||
    payload.targetText ||
    payload.zh ||
    payload.text ||
    payload.output
  );
  if (typeof direct === "string") return direct;

  if (payload.result) {
    const nested = extractTranslationFromJson(payload.result);
    if (nested) return nested;
  }

  const candidates = payload.translations || payload.items || payload.lines;
  if (Array.isArray(candidates)) {
    const text = candidates
      .map((item) => {
        if (typeof item === "string") return item;
        return item.translation || item.translated_text || item.text || item.content || "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }

  return JSON.stringify(payload, null, 2);
}

async function getCurrentPageImageBlob() {
  if (state.sourceType === "image") {
    return state.imageBlob;
  }

  const dpi = Number(els.dpiInput.value) || 260;
  const page = await state.pdfDoc.getPage(state.pageNum);
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("无法生成当前页 PNG。"));
    }, "image/png");
  });
}

async function downloadCurrentPageImage() {
  if (!state.pageCount) {
    setStatus("请先上传 PDF 或图片。", "warn");
    return;
  }

  try {
    await syncPageInputBeforeAction();
    const blob = await getCurrentPageImageBlob();
    downloadBlob(blob, makePageImageName());
    setStatus(`已导出第 ${state.pageNum} 页 PNG。`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function makePageImageName() {
  const safeName = (state.sourceName || "source")
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "_");
  return `${safeName}_page_${String(state.pageNum).padStart(4, "0")}.png`;
}

async function copyCurrentText() {
  try {
    await navigator.clipboard.writeText(els.ocrText.value);
    setStatus("当前页 OCR 文本已复制。", "ok");
  } catch {
    els.ocrText.select();
    document.execCommand("copy");
    setStatus("当前页 OCR 文本已复制。", "ok");
  }
}

async function copyCurrentTranslation() {
  try {
    await navigator.clipboard.writeText(els.translationText.value);
    setStatus("当前页译文已复制。", "ok");
  } catch {
    els.translationText.select();
    document.execCommand("copy");
    setStatus("当前页译文已复制。", "ok");
  }
}

function clearCurrentText() {
  if (!state.pageCount) return;
  state.ocrResults.delete(state.pageNum);
  els.ocrText.value = "";
  saveCachedResults();
  setStatus(`已清空第 ${state.pageNum} 页 OCR 文本。`, "ok");
  updateOcrPanelForPage();
  updateSummary();
  updateThumbnailState();
}

function setOcrView(view) {
  state.ocrView = view === "text" ? "text" : "lines";
  const showLines = state.ocrView === "lines";
  els.ocrLineCompare.classList.toggle("is-hidden", !showLines);
  els.ocrText.classList.toggle("is-hidden", showLines);
  els.lineViewButton.classList.toggle("active", showLines);
  els.textViewButton.classList.toggle("active", !showLines);
  els.lineViewButton.setAttribute("aria-pressed", String(showLines));
  els.textViewButton.setAttribute("aria-pressed", String(!showLines));
  if (showLines) {
    renderOcrLineComparison();
  }
}

function renderOcrLineComparison() {
  els.ocrLineCompare.innerHTML = "";
  if (!state.pageCount) return;

  const result = state.ocrResults.get(state.pageNum);
  const lines = result?.lines || extractOcrLines(result?.raw);
  if (!lines?.length) {
    const empty = document.createElement("div");
    empty.className = "line-compare-empty";
    empty.innerHTML = result?.text
      ? "<strong>当前结果没有原文行切片</strong><span>可切换到“纯文本”继续校对；重新使用本地 BDRC 服务识别可生成逐行对照。</span>"
      : "<strong>等待 OCR 识别</strong><span>识别完成后，这里会按行显示原文图像与可编辑文字。</span>";
    els.ocrLineCompare.appendChild(empty);
    return;
  }

  lines.forEach((line, index) => {
    const row = document.createElement("section");
    row.className = "ocr-line-row";

    const rowHeader = document.createElement("div");
    rowHeader.className = "ocr-line-number";
    rowHeader.textContent = String(index + 1).padStart(2, "0");

    const content = document.createElement("div");
    content.className = "ocr-line-content";

    if (line.image) {
      const imageWrap = document.createElement("div");
      imageWrap.className = "ocr-line-image";
      const image = document.createElement("img");
      image.src = line.image;
      image.alt = `第 ${index + 1} 行原文`;
      image.loading = "lazy";
      imageWrap.appendChild(image);
      content.appendChild(imageWrap);
    } else {
      const unavailable = document.createElement("div");
      unavailable.className = "ocr-line-image unavailable";
      unavailable.textContent = "无原文行切片";
      content.appendChild(unavailable);
    }

    const editor = document.createElement("textarea");
    editor.className = "ocr-line-editor";
    editor.rows = 1;
    editor.spellcheck = false;
    editor.value = line.text || "";
    editor.setAttribute("aria-label", `第 ${index + 1} 行 OCR 文本`);
    editor.addEventListener("input", () => {
      line.text = editor.value;
      resizeLineEditor(editor);
      syncLineEditorsToResult(lines);
    });

    content.appendChild(editor);
    row.append(rowHeader, content);
    els.ocrLineCompare.appendChild(row);
    resizeLineEditor(editor);
  });
}

function resizeLineEditor(editor) {
  editor.style.height = "auto";
  editor.style.height = `${Math.max(48, editor.scrollHeight)}px`;
}

function syncLineEditorsToResult(lines) {
  const text = lines.map((line) => line.text || "").join("\n");
  const existing = state.ocrResults.get(state.pageNum) || {};
  state.ocrResults.set(state.pageNum, {
    ...existing,
    text,
    lines,
    source: existing.source || "manual",
    updatedAt: new Date().toISOString(),
  });
  els.ocrText.value = text;
  saveCachedResults();
  updateSummary();
  updateThumbnailState();
}

function clearCurrentTranslation() {
  if (!state.pageCount) return;
  state.translationResults.delete(state.pageNum);
  els.translationText.value = "";
  saveCachedResults();
  setStatus(`已清空第 ${state.pageNum} 页藏译汉文本。`, "ok");
  updateTranslationPanelForPage();
  updateTranslationSummary();
  updateThumbnailState();
}

function downloadAllOcrText() {
  if (!state.ocrResults.size) {
    setStatus("还没有可导出的 OCR 文本。", "warn");
    return;
  }

  const pages = [...state.ocrResults.entries()].sort((a, b) => a[0] - b[0]);
  const body = [
    `# ${state.sourceName || "BDRC OCR"} OCR 对照结果`,
    "",
    ...pages.flatMap(([pageNum, result]) => [
      `## 第 ${pageNum} 页`,
      "",
      result.text || "",
      "",
    ]),
  ].join("\n");
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const safeName = (state.sourceName || "bdrc-ocr").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_");
  downloadBlob(blob, `${safeName}_ocr.md`);
  setStatus("已导出全部 OCR 文本。", "ok");
}

function downloadAllTranslationText() {
  if (!state.translationResults.size) {
    setStatus("还没有可导出的藏译汉文本。", "warn");
    return;
  }

  const pages = [...state.translationResults.entries()].sort((a, b) => a[0] - b[0]);
  const body = [
    `# ${state.sourceName || "藏译汉"} 翻译结果`,
    "",
    ...pages.flatMap(([pageNum, result]) => [
      `## 第 ${pageNum} 页`,
      "",
      result.text || "",
      "",
    ]),
  ].join("\n");
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const safeName = (state.sourceName || "tibetan-zh").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_");
  downloadBlob(blob, `${safeName}_zh.md`);
  setStatus("已导出全部藏译汉文本。", "ok");
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function updateOcrPanelForPage() {
  const result = state.ocrResults.get(state.pageNum);
  els.ocrTitle.textContent = state.sourceType === "image" ? "图片 OCR" : `第 ${state.pageNum} 页 OCR`;
  els.ocrText.value = result?.text || "";
  els.ocrMeta.textContent = result?.text ? "已识别" : "未识别";
  els.ocrMeta.style.color = result?.text ? "var(--green-deep)" : "var(--muted)";
  renderOcrLineComparison();
  updateSummary();
}

function updateTranslationPanelForPage() {
  const result = state.translationResults.get(state.pageNum);
  els.translationTitle.textContent = state.sourceType === "image" ? "图片藏译汉" : `第 ${state.pageNum} 页藏译汉`;
  els.translationText.value = result?.text || "";
  els.translationMeta.textContent = result?.text ? "已翻译" : "未翻译";
  els.translationMeta.style.color = result?.text ? "var(--blue)" : "var(--muted)";
  updateTranslationSummary();
}

function updateSummary() {
  const text = els.ocrText.value || "";
  els.charCount.textContent = String([...text.replace(/\s+/g, "")].length);
  const recognized = [...state.ocrResults.values()].filter((result) => (result.text || "").trim()).length;
  els.recognizedCount.textContent = `${recognized} / ${state.pageCount || 0}`;
  updateFileOcrStatus(recognized);
}

function updateFileOcrStatus(recognizedCount = null) {
  const recognized = recognizedCount ?? [...state.ocrResults.values()].filter((result) => (result.text || "").trim()).length;
  let text = "ocr 识别未开始";
  let className = "file-status status-not-started";

  if (state.pageCount && recognized >= state.pageCount) {
    text = "ocr 识别已完成";
    className = "file-status status-complete";
  } else if (recognized > 0) {
    text = "ocr 识别进行中";
    className = "file-status status-in-progress";
  }

  els.fileOcrStatus.textContent = text;
  els.fileOcrStatus.className = className;
}

function updateTranslationSummary() {
  const text = els.translationText.value || "";
  els.translationCharCount.textContent = String([...text.replace(/\s+/g, "")].length);
  const translated = [...state.translationResults.values()].filter((result) => (result.text || "").trim()).length;
  els.translatedCount.textContent = `${translated} / ${state.pageCount || 0}`;
}

function updateThumbnailState() {
  els.thumbnailList.querySelectorAll(".thumbnail-button").forEach((button) => {
    const pageNum = Number(button.dataset.page);
    const recognized = Boolean((state.ocrResults.get(pageNum)?.text || "").trim());
    const translated = Boolean((state.translationResults.get(pageNum)?.text || "").trim());
    button.classList.toggle("active", pageNum === state.pageNum);
    button.classList.toggle("recognized", recognized);
    button.classList.toggle("translated", translated);
  });
}

function refreshControls() {
  const hasDocument = state.pageCount > 0;
  els.pageInput.disabled = !hasDocument;
  els.pageInput.max = String(state.pageCount || 1);
  els.pageInput.value = String(state.pageNum || 1);
  els.pageTotal.textContent = `/ ${state.pageCount || 0}`;
  els.prevButton.disabled = !hasDocument || state.pageNum <= 1;
  els.nextButton.disabled = !hasDocument || state.pageNum >= state.pageCount;
  els.ocrButton.disabled = !hasDocument;
  els.downloadPageButton.disabled = !hasDocument;
  els.copyButton.disabled = !hasDocument;
  els.clearButton.disabled = !hasDocument;
  els.downloadTextButton.disabled = !hasDocument;
  els.translateButton.disabled = !hasDocument;
  els.copyTranslationButton.disabled = !hasDocument;
  els.clearTranslationButton.disabled = !hasDocument;
  els.downloadTranslationButton.disabled = !hasDocument;
}

function setBusy(isBusy) {
  els.ocrButton.disabled = isBusy || !state.pageCount;
  els.checkOcrButton.disabled = isBusy;
  els.ocrButton.querySelector("span").textContent = isBusy ? "识别中..." : "识别当前页";
}

function setTranslateBusy(isBusy) {
  els.translateButton.disabled = isBusy || !state.pageCount;
  els.checkTranslateButton.disabled = isBusy;
  els.translateButton.querySelector("span").textContent = isBusy ? "翻译中..." : "翻译当前页";
}

function formatNetworkError(error, url, service = "ocr") {
  if (String(error?.message || "").includes("Failed to fetch")) {
    if (service === "translate") {
      return `无法连接 ${url}。请先启动本地藏译汉服务：python3 bdrc-ocr-compare/nllb_translate_server.py；或把接口地址改成可用的翻译 API。`;
    }
    return `无法连接 ${url}。请先启动本地 OCR 服务：python3 bdrc-ocr-compare/bdrc_ocr_server.py`;
  }
  return error?.message || String(error);
}

function setStatus(message, tone = "") {
  els.statusBar.textContent = message;
  els.statusBar.className = `status-bar ${tone}`.trim();
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function debounce(fn, wait) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}
