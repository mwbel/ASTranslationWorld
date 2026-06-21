const SAMPLE_PDF_URL = "../藏文/天文历算学-本科教材 藏文40301698_部分.pdf";
const PDF_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const els = {};
const state = {
  pdfDoc: null,
  imageUrl: "",
  imageBlob: null,
  sourceName: "",
  sourceType: "",
  pageNum: 1,
  pageCount: 0,
  ocrResults: new Map(),
  renderToken: 0,
};

window.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  wireEvents();
  configurePdfJs();
  refreshControls();
  updateSummary();
  if (window.lucide) {
    window.lucide.createIcons();
  }
});

function cacheElements() {
  [
    "fileInput",
    "sampleButton",
    "endpointInput",
    "dpiInput",
    "pageInput",
    "pageTotal",
    "prevButton",
    "nextButton",
    "zoomInput",
    "checkOcrButton",
    "ocrButton",
    "downloadPageButton",
    "statusBar",
    "thumbnailList",
    "sourceTitle",
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
    "ocrText",
    "charCount",
    "recognizedCount",
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
  els.ocrButton.addEventListener("click", runOcrForCurrentPage);
  els.downloadPageButton.addEventListener("click", downloadCurrentPageImage);
  els.copyButton.addEventListener("click", copyCurrentText);
  els.clearButton.addEventListener("click", clearCurrentText);
  els.downloadTextButton.addEventListener("click", downloadAllOcrText);

  els.ocrText.addEventListener("input", () => {
    if (!state.pageCount) return;
    const existing = state.ocrResults.get(state.pageNum) || {};
    state.ocrResults.set(state.pageNum, {
      ...existing,
      text: els.ocrText.value,
      source: existing.source || "manual",
      updatedAt: new Date().toISOString(),
    });
    updateSummary();
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

  const buffer = await file.arrayBuffer();
  const task = window.pdfjsLib.getDocument({ data: buffer });
  state.pdfDoc = await task.promise;
  state.sourceType = "pdf";
  state.pageNum = 1;
  state.pageCount = state.pdfDoc.numPages;

  els.sourceTitle.textContent = state.sourceName;
  els.ocrTitle.textContent = "第 1 页 OCR";
  setStatus(`已载入 ${state.sourceName}，共 ${state.pageCount} 页。`, "ok");
  refreshControls();
  renderCurrentPage();
  buildPdfThumbnails();
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
  setStatus(`已载入图片 ${state.sourceName}。`, "ok");
  refreshControls();
  renderCurrentPage();
  buildImageThumbnail();
}

function resetDocumentState() {
  if (state.imageUrl) {
    URL.revokeObjectURL(state.imageUrl);
  }

  state.pdfDoc = null;
  state.imageUrl = "";
  state.imageBlob = null;
  state.sourceName = "";
  state.sourceType = "";
  state.pageNum = 1;
  state.pageCount = 0;
  state.ocrResults.clear();
  state.renderToken += 1;

  els.thumbnailList.innerHTML = "";
  els.ocrText.value = "";
  els.imagePage.removeAttribute("src");
  els.pdfCanvas.style.display = "none";
  els.imagePage.style.display = "none";
  els.emptyState.style.display = "grid";
  els.sourceTitle.textContent = "未载入文件";
  els.ocrTitle.textContent = "等待识别";
  els.renderMeta.textContent = "0 页";
  els.ocrMeta.textContent = "未识别";
  refreshControls();
  updateSummary();
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
  updateThumbnailState();
}

function renderImagePage() {
  els.pdfCanvas.style.display = "none";
  els.imagePage.style.display = "block";
  els.emptyState.style.display = "none";
  els.renderMeta.textContent = "1 / 1";
  els.pageInput.value = "1";
  updateOcrPanelForPage();
  updateThumbnailState();
}

async function buildPdfThumbnails() {
  els.thumbnailList.innerHTML = "";
  const doc = state.pdfDoc;
  const count = state.pageCount;

  for (let pageNum = 1; pageNum <= count; pageNum += 1) {
    const button = document.createElement("button");
    button.className = "thumbnail-button";
    button.type = "button";
    button.dataset.page = String(pageNum);
    button.innerHTML = `<span>${pageNum}</span>`;
    button.addEventListener("click", () => goToPage(pageNum));
    els.thumbnailList.appendChild(button);
  }

  updateThumbnailState();

  for (let pageNum = 1; pageNum <= count; pageNum += 1) {
    const button = els.thumbnailList.querySelector(`[data-page="${pageNum}"]`);
    if (!button || doc !== state.pdfDoc) return;
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 0.12 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    button.prepend(canvas);
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
      source: "bdrc",
      updatedAt: new Date().toISOString(),
    });
    els.ocrText.value = text;
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

function clearCurrentText() {
  if (!state.pageCount) return;
  state.ocrResults.delete(state.pageNum);
  els.ocrText.value = "";
  setStatus(`已清空第 ${state.pageNum} 页 OCR 文本。`, "ok");
  updateOcrPanelForPage();
  updateSummary();
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
  updateSummary();
}

function updateSummary() {
  const text = els.ocrText.value || "";
  els.charCount.textContent = String([...text.replace(/\s+/g, "")].length);
  const recognized = [...state.ocrResults.values()].filter((result) => (result.text || "").trim()).length;
  els.recognizedCount.textContent = `${recognized} / ${state.pageCount || 0}`;
}

function updateThumbnailState() {
  els.thumbnailList.querySelectorAll(".thumbnail-button").forEach((button) => {
    const pageNum = Number(button.dataset.page);
    const recognized = Boolean((state.ocrResults.get(pageNum)?.text || "").trim());
    button.classList.toggle("active", pageNum === state.pageNum);
    button.classList.toggle("recognized", recognized);
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
}

function setBusy(isBusy) {
  els.ocrButton.disabled = isBusy || !state.pageCount;
  els.checkOcrButton.disabled = isBusy;
  els.ocrButton.querySelector("span").textContent = isBusy ? "识别中..." : "识别当前页";
}

function formatNetworkError(error, url) {
  if (String(error?.message || "").includes("Failed to fetch")) {
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
