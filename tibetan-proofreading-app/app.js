const SAMPLE_PDF_URL = "../藏文/天文历算学-本科教材 藏文40301698_部分.pdf";
const PDF_WORKER_URL = "./vendor/pdf.worker.min.js";
const APP_BUILD_ID = "20260708-proofread-blocks-27";
window.__TIBETAN_PROOFREADING_APP_BUILD_ID__ = APP_BUILD_ID;
const CACHE_PREFIX = "tibetan-proofreading-app:v1:";
const OCR_FONT_SIZE_KEY = "tibetan-proofreading-app:ocr-font-size";
const LEGACY_WORKSPACE_LAYOUT_KEYS = [
  "tibetan-proofreading-app:workspace-layout",
  "tibetan-proofreading-app:workspace-layout:v2",
  "tibetan-proofreading-app:workspace-layout:v3",
];
const WORKSPACE_LAYOUT_KEY = "tibetan-proofreading-app:workspace-layout:v4";
const TRANSLATION_ROLES_KEY = "tibetan-proofreading-app:translation-roles";
const ACTIVE_TRANSLATION_ROLE_KEY = "tibetan-proofreading-app:active-translation-role";
const OCR_FONT_SIZE_MIN = 16;
const OCR_FONT_SIZE_MAX = 36;
const OCR_FONT_SIZE_STEP = 2;
const TIBETAN_HIGH_RISK_MARK_RE = /[\u0F71-\u0F84\u0F90-\u0FBC]/;
const TIBETAN_CLUSTER_RE = /[\u0F40-\u0F6C][\u0F71-\u0F84\u0F90-\u0FBC]*/g;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DIRECT_TEXT_SOURCES = new Set(["pdf-text", "word-text", "markdown", "text-file"]);
const QUIET_STATUS_RE =
  /^(已载入|已识别源文档属性|已切换到|已取消|已新建|已删除|已保存|已重置|已清空|已导出|当前页.*已复制|第\s*\d+\s*页已从 PDF 文本层直接提取|第\s*\d+\s*页藏译汉完成)/;
const EMPTY_STATE_HTML = `
  <i data-lucide="file-search"></i>
  <p>上传藏文 PDF 后，这里显示当前单页原文。</p>
`;
const DEFAULT_LAYOUT = {
  viewer: 1.18,
  ocr: 0.92,
  ai: 0.92,
  translation: 0.86,
  translationCollapsed: true,
  collapsed: {
    viewer: false,
    ocr: false,
    ai: false,
  },
};
const DEFAULT_TRANSLATION_MODEL = "gemini:gemini-2.5-flash";
const BUILT_IN_TRANSLATION_ROLES = [
  {
    id: "academic-literal",
    name: "学术直译",
    sourceLang: "bo",
    targetLang: "zh",
    model: DEFAULT_TRANSLATION_MODEL,
    systemPrompt: "你是严谨的佛学与藏文典籍翻译助手。请忠实翻译原文，保持术语稳定，少发挥；不添加原文没有的信息。",
    userPromptTemplate: "请将以下{source_lang}文本翻译为{target_lang}。要求忠实、术语一致、适合学术校对，只输出译文。\n\n来源：{source_name}\n页码：{page}\n\n原文：\n{source_text}",
    temperature: 0.2,
    maxTokens: 2048,
    builtIn: true,
  },
  {
    id: "fluent-english",
    name: "通顺英译",
    sourceLang: "zh",
    targetLang: "en",
    model: DEFAULT_TRANSLATION_MODEL,
    systemPrompt: "You are a careful Chinese-to-English translator. Preserve meaning and terminology while producing fluent academic English.",
    userPromptTemplate: "Translate the following {source_lang} text into {target_lang}. Keep the meaning faithful, smooth the prose where appropriate, and output only the translation.\n\nSource: {source_name}\nPage: {page}\n\nText:\n{source_text}",
    temperature: 0.3,
    maxTokens: 2048,
    builtIn: true,
  },
  {
    id: "dzongsar-reference-en-zh",
    name: "宗萨参考英译中",
    sourceLang: "en",
    targetLang: "zh",
    model: DEFAULT_TRANSLATION_MODEL,
    systemPrompt: [
      "你是佛学、文学与公共开示文本的英译中助手。",
      "译文应参考当代佛学开示中文译本常见的清澈、直接、自然、有一点口语感的表达。",
      "保留原文的思辨锋芒、幽默和反讽，但不要添加原文没有的判断。",
      "术语要稳定，优先使用通行佛学中文译名；遇到可疑术语可保留英文括注。",
      "不要声称模仿任何具体作者本人，只输出译文。",
    ].join(""),
    userPromptTemplate: "请将以下英文文本翻译为中文。要求：忠实、通顺、不过度文言，保留开示语气中的直接、轻松与反讽；只输出译文。\n\n来源：{source_name}\n页码：{page}\n\n英文原文：\n{source_text}",
    temperature: 0.28,
    maxTokens: 3072,
    builtIn: true,
  },
  {
    id: "term-analysis",
    name: "术语拆解",
    sourceLang: "bo",
    targetLang: "zh",
    model: DEFAULT_TRANSLATION_MODEL,
    systemPrompt: "你是藏文术语解析助手。请偏重逐词解释、术语对应和疑难点说明，避免过度润色。",
    userPromptTemplate: "请解析并翻译以下{source_lang}文本为{target_lang}。输出包括：1. 直译；2. 关键术语；3. 疑难处说明。\n\n来源：{source_name}\n页码：{page}\n\n原文：\n{source_text}",
    temperature: 0.1,
    maxTokens: 3072,
    builtIn: true,
  },
];

const els = {};
const state = {
  pdfDoc: null,
  pdfUrl: "",
  imageUrl: "",
  imageBlob: null,
  markdownText: "",
  documentText: "",
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
  ocrFontSize: 22,
  activeOcrLine: -1,
  renderToken: 0,
  thumbnailToken: 0,
  layout: { ...DEFAULT_LAYOUT },
  translationRoles: [...BUILT_IN_TRANSLATION_ROLES],
  activeTranslationRoleId: "academic-literal",
  editingRoleId: "academic-literal",
  isOcrBusy: false,
  isTranslateBusy: false,
};

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.appBuild = APP_BUILD_ID;
  cacheElements();
  restoreTranslationRoles();
  restoreOcrFontSize();
  restoreWorkspaceLayout();
  wireEvents();
  renderTranslationRoleOptions();
  renderActiveTranslationRoleMeta();
  configurePdfJs();
  refreshControls();
  updateSummary();
  updateTranslationSummary();
  warnIfFileProtocol();
  if (window.lucide) {
    window.lucide.createIcons();
  }
});

function cacheElements() {
  [
    "fileLoadButton",
    "newProjectButton",
    "deleteProjectButton",
    "fileInput",
    "ocrModeSelect",
    "endpointInput",
    "aiOcrEndpointInput",
    "translateEndpointInput",
    "dpiInput",
    "pageInput",
    "pageTotal",
    "prevButton",
    "nextButton",
    "viewerFirstPageButton",
    "viewerPrevPageButton",
    "viewerPageInput",
    "viewerNextPageButton",
    "viewerLastPageButton",
    "zoomInput",
    "checkTranslateButton",
    "ocrButton",
    "statusBar",
    "thumbnailList",
    "sourceTitle",
    "fileOcrStatus",
    "renderMeta",
    "pageViewport",
    "pdfCanvas",
    "imagePage",
    "sourceBlockOverlay",
    "sourceLineHighlight",
    "emptyState",
    "ocrPaneEyebrow",
    "ocrTitle",
    "ocrMeta",
    "copyButton",
    "downloadTextButton",
    "decreaseOcrFontButton",
    "increaseOcrFontButton",
    "ocrViewSwitch",
    "proofreadViewButton",
    "compareViewButton",
    "lineViewButton",
    "textViewButton",
    "ocrLineCompare",
    "ocrText",
    "charCount",
    "recognizedCount",
    "aiOcrTitle",
    "aiOcrMeta",
    "copyAiButton",
    "downloadAiTextButton",
    "aiOcrLineCompare",
    "aiCharCount",
    "aiLineCount",
    "translationTitle",
    "translationMeta",
    "translationRoleSelect",
    "manageRolesButton",
    "translationRoleModel",
    "translateButton",
    "copyTranslationButton",
    "clearTranslationButton",
    "downloadTranslationButton",
    "translationText",
    "translationCharCount",
    "translatedCount",
    "toggleTranslationPaneButton",
    "roleManagerModal",
    "closeRoleManagerButton",
    "roleList",
    "roleForm",
    "newRoleButton",
    "saveRoleButton",
    "deleteRoleButton",
    "resetRolesButton",
    "roleNameInput",
    "roleIdInput",
    "roleSourceLangInput",
    "roleTargetLangInput",
    "roleModelInput",
    "roleTemperatureInput",
    "roleMaxTokensInput",
    "roleSystemPromptInput",
    "roleUserPromptTemplateInput",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
  els.appShell = document.querySelector(".app-shell");
  els.workspace = document.querySelector(".workspace");
  els.resizers = Array.from(document.querySelectorAll(".pane-resizer[data-resizer]"));
  els.paneCollapseButtons = Array.from(document.querySelectorAll("[data-collapse-pane]"));
}

function wireEvents() {
  els.fileLoadButton.addEventListener("click", () => {
    if (!els.fileInput) {
      setStatus("文件选择控件未初始化，请刷新页面后重试。", "error");
      return;
    }
    els.fileInput.value = "";
    els.fileInput.click();
  });

  bindOptionalClick("newProjectButton", newProject);
  bindOptionalClick("deleteProjectButton", deleteCurrentProject);

  els.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file) {
      try {
        await loadFile(file);
      } catch (error) {
        console.error("Failed to load file", error);
        setStatus(`文件加载失败：${error.message || error}`, "error");
      } finally {
        event.target.value = "";
      }
    } else {
      setStatus("已取消文件选择。", "warn");
    }
  });

  els.prevButton.addEventListener("click", () => goToPage(state.pageNum - 1));
  els.nextButton.addEventListener("click", () => goToPage(state.pageNum + 1));
  els.viewerFirstPageButton.addEventListener("click", () => goToPage(1));
  els.viewerPrevPageButton.addEventListener("click", () => goToPage(state.pageNum - 1));
  els.viewerNextPageButton.addEventListener("click", () => goToPage(state.pageNum + 1));
  els.viewerLastPageButton.addEventListener("click", () => goToPage(state.pageCount));

  els.pageInput.addEventListener("change", () => {
    goToPage(Number(els.pageInput.value));
  });
  els.pageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      goToPage(Number(els.pageInput.value));
    }
  });
  els.viewerPageInput.addEventListener("change", () => {
    goToPage(Number(els.viewerPageInput.value));
  });
  els.viewerPageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      goToPage(Number(els.viewerPageInput.value));
    }
  });

  els.zoomInput.addEventListener("change", renderCurrentPage);
  els.pageViewport.addEventListener("click", handleSourceViewportClick);
  els.ocrModeSelect.addEventListener("change", () => {
    const mode = getOcrMode();
    if (mode === "smart") {
      setStatus("已切换到智能识别：先用 BDRC 识别，再用 LLM/AI Vision 校正。", "warn");
    } else if (mode === "ai") {
      setStatus("已切换到仅 AI Vision：将直接调用 AI OCR 接口。", "warn");
    } else {
      setStatus("已切换到仅本地 BDRC：不会调用 AI OCR 接口。", "warn");
    }
  });
  bindOptionalClick("checkTranslateButton", checkTranslateService);
  els.ocrButton.addEventListener("click", runOcrForCurrentPage);
  els.copyButton.addEventListener("click", copyCurrentText);
  els.downloadTextButton.addEventListener("click", downloadAllOcrText);
  els.copyAiButton.addEventListener("click", copyCurrentAiText);
  els.downloadAiTextButton.addEventListener("click", downloadAllAiOcrText);
  els.decreaseOcrFontButton.addEventListener("click", () => {
    setOcrFontSize(state.ocrFontSize - OCR_FONT_SIZE_STEP);
  });
  els.increaseOcrFontButton.addEventListener("click", () => {
    setOcrFontSize(state.ocrFontSize + OCR_FONT_SIZE_STEP);
  });
  els.proofreadViewButton.addEventListener("click", () => setOcrView("proofread"));
  els.compareViewButton.addEventListener("click", () => setOcrView("compare"));
  els.lineViewButton.addEventListener("click", () => setOcrView("lines"));
  els.textViewButton.addEventListener("click", () => setOcrView("text"));
  els.translationRoleSelect.addEventListener("change", () => {
    state.activeTranslationRoleId = els.translationRoleSelect.value;
    saveActiveTranslationRole();
    renderActiveTranslationRoleMeta();
  });
  els.manageRolesButton.addEventListener("click", openRoleManager);
  els.closeRoleManagerButton.addEventListener("click", closeRoleManager);
  els.roleManagerModal.addEventListener("click", (event) => {
    if (event.target === els.roleManagerModal) {
      closeRoleManager();
    }
  });
  els.newRoleButton.addEventListener("click", createDraftTranslationRole);
  els.roleForm.addEventListener("submit", saveRoleFromForm);
  els.deleteRoleButton.addEventListener("click", deleteEditingTranslationRole);
  els.resetRolesButton.addEventListener("click", resetCustomTranslationRoles);
  els.translateButton.addEventListener("click", runTranslateForCurrentPage);
  els.copyTranslationButton.addEventListener("click", copyCurrentTranslation);
  els.clearTranslationButton.addEventListener("click", clearCurrentTranslation);
  els.downloadTranslationButton.addEventListener("click", downloadAllTranslationText);
  els.toggleTranslationPaneButton.addEventListener("click", () => {
    setTranslationCollapsed(!state.layout.translationCollapsed);
  });
  els.paneCollapseButtons.forEach((button) => {
    button.addEventListener("click", () => togglePaneCollapsed(button.dataset.collapsePane));
  });
  wireWorkspaceResizers();

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
        lines.push({ text: textLines[index], bbox: null, index });
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
    } else {
      renderActiveSourceHighlight();
    }
  }, 160));
}

function bindOptionalClick(id, handler) {
  if (els[id]) {
    els[id].addEventListener("click", handler);
  }
}

function configurePdfJs() {
  if (!window.pdfjsLib) {
    setStatus("PDF.js 未加载，检查网络或换用本地依赖。", "error");
    return;
  }
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
}

function warnIfFileProtocol() {
  if (window.location.protocol !== "file:") return;
  setStatus(
    "当前通过 file:// 打开，PDF worker、缓存和本地 OCR/AI Vision 接口可能不稳定；请使用 http://127.0.0.1:8790/tibetan-proofreading-app/ 打开。",
    "error"
  );
}

function restoreOcrFontSize() {
  const storedSize = Number(window.localStorage.getItem(OCR_FONT_SIZE_KEY));
  setOcrFontSize(Number.isFinite(storedSize) ? storedSize : state.ocrFontSize, false);
}

function restoreWorkspaceLayout() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(WORKSPACE_LAYOUT_KEY) || "null");
    if (stored && typeof stored === "object") {
      state.layout = normalizeWorkspaceLayout(stored);
    } else {
      state.layout = normalizeWorkspaceLayout();
    }
  } catch (_error) {
    state.layout = normalizeWorkspaceLayout();
  }
  LEGACY_WORKSPACE_LAYOUT_KEYS.forEach((key) => window.localStorage.removeItem(key));
  applyWorkspaceLayout();
}

function persistWorkspaceLayout() {
  state.layout = normalizeWorkspaceLayout(state.layout);
  window.localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(state.layout));
}

function normalizeWorkspaceLayout(layout = {}) {
  const next = { ...DEFAULT_LAYOUT, ...layout };
  next.collapsed = { ...DEFAULT_LAYOUT.collapsed, ...(layout.collapsed || {}) };
  const safeNumber = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

  next.viewer = clamp(safeNumber(next.viewer, DEFAULT_LAYOUT.viewer), 0.55, 2.4);
  next.ocr = clamp(safeNumber(next.ocr, DEFAULT_LAYOUT.ocr), 0.45, 1.9);
  next.ai = clamp(safeNumber(next.ai, DEFAULT_LAYOUT.ai), 0.45, 1.9);
  next.translation = clamp(safeNumber(next.translation, DEFAULT_LAYOUT.translation), 0.4, 1.6);
  next.translationCollapsed = Boolean(next.translationCollapsed);
  next.collapsed.viewer = Boolean(next.collapsed.viewer);
  next.collapsed.ocr = Boolean(next.collapsed.ocr);
  next.collapsed.ai = Boolean(next.collapsed.ai);

  return next;
}

function isOcrOnlyWorkspace() {
  const translationFeatureHidden = Boolean(
    els.translationText?.closest(".translation-feature") ||
    els.translateButton?.closest(".translation-feature")
  );
  return Boolean(
    translationFeatureHidden ||
    els.workspace?.classList.contains("ocr-only-mode") ||
    els.appShell?.classList.contains("ocr-only-mode")
  );
}

function applyWorkspaceLayout() {
  state.layout = normalizeWorkspaceLayout(state.layout);
  const ocrOnly = isOcrOnlyWorkspace();
  const collapsed = state.layout.collapsed;
  if (ocrOnly) {
    state.layout.translationCollapsed = true;
    els.workspace.classList.add("ocr-only-mode");
    els.appShell?.classList.add("ocr-only-mode");
  }

  els.workspace.style.setProperty("--viewer-min", collapsed.viewer ? "52px" : "300px");
  els.workspace.style.setProperty("--ocr-min", collapsed.ocr ? "52px" : "240px");
  els.workspace.style.setProperty("--ai-ocr-min", collapsed.ai ? "52px" : "240px");
  els.workspace.style.setProperty("--viewer-width", collapsed.viewer ? "52px" : `${state.layout.viewer}fr`);
  els.workspace.style.setProperty("--ocr-width", collapsed.ocr ? "52px" : `${state.layout.ocr}fr`);
  els.workspace.style.setProperty("--ai-ocr-width", collapsed.ai ? "52px" : `${state.layout.ai}fr`);
  els.workspace.style.setProperty(
    "--translation-width",
    state.layout.translationCollapsed || ocrOnly ? "0px" : `${state.layout.translation}fr`,
  );
  els.workspace.classList.toggle("translation-collapsed", state.layout.translationCollapsed || ocrOnly);
  els.workspace.classList.toggle("viewer-collapsed", collapsed.viewer);
  els.workspace.classList.toggle("ocr-collapsed", collapsed.ocr);
  els.workspace.classList.toggle("ai-collapsed", collapsed.ai);
  updatePaneCollapseButtons();
  els.toggleTranslationPaneButton.setAttribute(
    "aria-label",
    state.layout.translationCollapsed ? "展开藏译汉结果栏" : "折叠藏译汉结果栏",
  );
  els.toggleTranslationPaneButton.setAttribute(
    "aria-expanded",
    String(!state.layout.translationCollapsed),
  );
  const icon = els.toggleTranslationPaneButton.querySelector("[data-lucide]");
  if (icon) {
    icon.setAttribute(
      "data-lucide",
      state.layout.translationCollapsed ? "panel-right-open" : "panel-right-close",
    );
  }
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function togglePaneCollapsed(pane) {
  if (!["viewer", "ocr", "ai"].includes(pane)) return;
  state.layout.collapsed[pane] = !state.layout.collapsed[pane];
  applyWorkspaceLayout();
  persistWorkspaceLayout();
  window.requestAnimationFrame(renderSourceBlockOverlay);
}

function updatePaneCollapseButtons() {
  const labels = {
    viewer: ["原文栏", "panel-left"],
    ocr: ["BDRC OCR 栏", "panel-left"],
    ai: ["AI Vision 栏", "panel-right"],
  };
  els.paneCollapseButtons?.forEach((button) => {
    const pane = button.dataset.collapsePane;
    const collapsed = Boolean(state.layout.collapsed[pane]);
    const [label, iconBase] = labels[pane] || ["边栏", "panel-left"];
    button.setAttribute("aria-label", `${collapsed ? "展开" : "折叠"}${label}`);
    button.setAttribute("title", `${collapsed ? "展开" : "折叠"}${label}`);
    button.setAttribute("aria-expanded", String(!collapsed));
    const icon = button.querySelector("[data-lucide]");
    if (icon) {
      const direction = collapsed ? "open" : "close";
      icon.setAttribute("data-lucide", `${iconBase}-${direction}`);
    }
  });
}

function setTranslationCollapsed(collapsed) {
  state.layout.translationCollapsed = Boolean(collapsed);
  applyWorkspaceLayout();
  persistWorkspaceLayout();
}

function wireWorkspaceResizers() {
  const minimums = {
    viewer: 300,
    ocr: 260,
    ai: 260,
    translation: 280,
  };

  els.resizers.forEach((resizer) => {
    resizer.addEventListener("pointerdown", (event) => {
      if (
        resizer.dataset.resizer === "ai-translation" &&
        event.target.closest(".translation-toggle")
      ) {
        return;
      }

      const workspaceRect = els.workspace.getBoundingClientRect();
      const translationVisible = !state.layout.translationCollapsed && !isOcrOnlyWorkspace();
      const visibleResizerCount = translationVisible ? 3 : 2;
      const visibleGridColumnCount = translationVisible ? 7 : 5;
      const gapCount = Math.max(0, visibleGridColumnCount - 1);
      const collapsed = state.layout.collapsed;
      const collapsedWidth =
        (collapsed.viewer ? 52 : 0) +
        (collapsed.ocr ? 52 : 0) +
        (collapsed.ai ? 52 : 0);
      const flexWidth = workspaceRect.width - visibleResizerCount * 8 - gapCount * 16 - collapsedWidth;
      let startX = event.clientX;
      const totalFlex =
        (collapsed.viewer ? 0 : state.layout.viewer) +
        (collapsed.ocr ? 0 : state.layout.ocr) +
        (collapsed.ai ? 0 : state.layout.ai) +
        (translationVisible ? state.layout.translation : 0);
      if (totalFlex <= 0 || flexWidth <= 0) return;
      const startViewer = collapsed.viewer ? 0 : (flexWidth * state.layout.viewer) / totalFlex;
      const startOcr = collapsed.ocr ? 0 : (flexWidth * state.layout.ocr) / totalFlex;
      const startAi = collapsed.ai ? 0 : (flexWidth * state.layout.ai) / totalFlex;
      const startTranslation = translationVisible
        ? (flexWidth * state.layout.translation) / totalFlex
        : 0;

      const onMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;

        if (resizer.dataset.resizer === "viewer-ocr") {
          if (collapsed.viewer || collapsed.ocr) return;
          const nextViewer = clamp(
            startViewer + delta,
            minimums.viewer,
            flexWidth - minimums.ocr - startAi - startTranslation,
          );
          const nextOcr = flexWidth - nextViewer - startAi - startTranslation;
          state.layout.viewer = nextViewer / flexWidth;
          state.layout.ocr = nextOcr / flexWidth;
          applyWorkspaceLayout();
          return;
        }

        if (resizer.dataset.resizer === "ocr-ai") {
          if (collapsed.ocr || collapsed.ai) return;
          const nextOcr = clamp(
            startOcr + delta,
            minimums.ocr,
            flexWidth - startViewer - minimums.ai - startTranslation,
          );
          const nextAi = flexWidth - startViewer - nextOcr - startTranslation;
          state.layout.ocr = nextOcr / flexWidth;
          state.layout.ai = nextAi / flexWidth;
          applyWorkspaceLayout();
          return;
        }

        if (resizer.dataset.resizer === "ai-translation" && translationVisible) {
          if (collapsed.ai) return;
          const nextAi = clamp(
            startAi + delta,
            minimums.ai,
            flexWidth - startViewer - startOcr - minimums.translation,
          );
          const nextTranslation = flexWidth - startViewer - startOcr - nextAi;
          state.layout.ai = nextAi / flexWidth;
          state.layout.translation = nextTranslation / flexWidth;
          applyWorkspaceLayout();
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        persistWorkspaceLayout();
        renderSourceBlockOverlay();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  });
}

function setOcrFontSize(size, persist = true) {
  state.ocrFontSize = clamp(
    Math.round(Number(size) || 22),
    OCR_FONT_SIZE_MIN,
    OCR_FONT_SIZE_MAX,
  );
  document.documentElement.style.setProperty("--ocr-font-size", `${state.ocrFontSize}px`);
  document.documentElement.style.setProperty("--proofread-ocr-font-size", `${state.ocrFontSize}px`);
  els.decreaseOcrFontButton.disabled = state.ocrFontSize <= OCR_FONT_SIZE_MIN;
  els.increaseOcrFontButton.disabled = state.ocrFontSize >= OCR_FONT_SIZE_MAX;
  els.decreaseOcrFontButton.title = `减小 OCR / 校对字体（当前 ${state.ocrFontSize}px）`;
  els.increaseOcrFontButton.title = `增大 OCR / 校对字体（当前 ${state.ocrFontSize}px）`;
  els.ocrLineCompare.querySelectorAll(".ocr-line-editor, .proofread-editor").forEach(resizeLineEditor);
  if (persist) {
    window.localStorage.setItem(OCR_FONT_SIZE_KEY, String(state.ocrFontSize));
  }
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

  if (isWordFile(file)) {
    await loadWord(file);
    return;
  }

  if (file.type.startsWith("image/")) {
    await loadImage(file);
    return;
  }

  if (isMarkdownFile(file)) {
    await loadMarkdown(file);
    return;
  }

  setStatus("只支持 PDF、图片或 Markdown 文件。", "error");
}

function hasActiveDocument() {
  return Boolean(state.pageCount || state.sourceName || state.cacheKey);
}

function newProject() {
  if (state.isOcrBusy || state.isTranslateBusy) {
    setStatus("OCR 或翻译正在运行，请等当前任务结束后再新建项目。", "warn");
    return;
  }

  if (hasActiveDocument()) {
    const ok = window.confirm(
      `新建项目会关闭当前工作台中的“${state.sourceName || "未命名项目"}”。本地缓存不会被删除，源文件也不会被删除。是否继续？`
    );
    if (!ok) {
      setStatus("已取消新建项目。当前工作台保持不变。", "warn");
      return;
    }
  }

  resetDocumentState();
  setStatus("已新建空白项目。请点击“加载文件”开始。", "ok");
}

function deleteCurrentProject() {
  if (state.isOcrBusy || state.isTranslateBusy) {
    setStatus("OCR 或翻译正在运行，请等当前任务结束后再删除项目。", "warn");
    return;
  }

  if (!hasActiveDocument()) {
    setStatus("当前没有可删除的项目。请先加载文件。", "warn");
    return;
  }

  const projectName = state.sourceName || "当前项目";
  const cacheKey = state.cacheKey;
  const ok = window.confirm(
    `删除项目会移除“${projectName}”的本地 OCR/译文缓存，并清空当前工作台。磁盘上的源文件不会被删除。是否继续？`
  );
  if (!ok) {
    setStatus("已取消删除项目。当前工作台保持不变。", "warn");
    return;
  }

  if (cacheKey) {
    window.localStorage.removeItem(cacheKey);
  }
  resetDocumentState();
  setStatus(`已删除“${projectName}”的本地项目缓存。源文件未删除。`, "ok");
}

function isMarkdownFile(file) {
  const name = file.name.toLowerCase();
  return file.type === "text/markdown" ||
    file.type === "text/plain" ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    name.endsWith(".txt");
}

function isWordFile(file) {
  const name = file.name.toLowerCase();
  return file.type === DOCX_MIME || name.endsWith(".docx") || name.endsWith(".doc");
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
  await primeCurrentPageDirectText("load");
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

async function loadMarkdown(file) {
  const text = await file.text();
  const name = file.name.toLowerCase();
  const isPlainText = name.endsWith(".txt") || file.type === "text/plain";
  state.sourceType = isPlainText ? "text" : "markdown";
  state.markdownText = text;
  state.documentText = text;
  state.pageNum = 1;
  state.pageCount = 1;

  els.sourceTitle.textContent = state.sourceName;
  els.ocrTitle.textContent = isPlainText ? "文本文件" : "Markdown 文本";
  const restored = restoreCachedResults();
  const hasRestoredText = Boolean((state.ocrResults.get(1)?.text || "").trim());
  if (!hasRestoredText) {
    state.ocrResults.set(1, {
      text,
      lines: text.split("\n").map((line, index) => ({ text: line, bbox: null, index })),
      source: isPlainText ? "text-file" : "markdown",
      updatedAt: new Date().toISOString(),
    });
  }
  if (!restored) {
    saveCachedResults();
  }
  setStatus(
    restored && hasRestoredText
      ? `已载入 ${isPlainText ? "文本" : "Markdown"} ${state.sourceName}，并恢复本地暂存的 OCR/译文。`
      : `已载入 ${isPlainText ? "文本" : "Markdown"} ${state.sourceName}，可直接校对或翻译。`,
    "ok"
  );
  refreshControls();
  renderCurrentPage();
  setOcrView("text");
  buildTextThumbnail(isPlainText ? "TXT" : "MD");
}

async function loadWord(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".doc") && !name.endsWith(".docx")) {
    throw new Error("当前本地前端只支持 .docx 文本抽取；旧版 .doc 请先转为 .docx 或 PDF。");
  }

  const text = await extractDocxText(file);
  if (!text.trim()) {
    throw new Error("Word 文档没有提取到正文文本。");
  }

  state.sourceType = "word";
  state.documentText = text;
  state.markdownText = text;
  state.pageNum = 1;
  state.pageCount = 1;

  els.sourceTitle.textContent = state.sourceName;
  els.ocrTitle.textContent = "Word 文本";
  const restored = restoreCachedResults();
  const hasRestoredText = Boolean((state.ocrResults.get(1)?.text || "").trim());
  if (!hasRestoredText) {
    state.ocrResults.set(1, makeTextResult(text, "word-text"));
  }
  if (!restored) {
    saveCachedResults();
  }
  setStatus(
    restored && hasRestoredText
      ? `已载入 Word ${state.sourceName}，并恢复本地暂存的 OCR/译文。`
      : `已载入 Word ${state.sourceName}，已直接提取文本，可直接翻译。`,
    "ok"
  );
  refreshControls();
  renderCurrentPage();
  setOcrView("text");
  buildTextThumbnail("DOCX");
}

function resetDocumentState() {
  state.thumbnailToken += 1;
  clearSourceBlockOverlay();

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
  state.markdownText = "";
  state.documentText = "";
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
  els.emptyState.innerHTML = EMPTY_STATE_HTML;
  els.sourceTitle.textContent = "未载入文件";
  updateFileOcrStatus();
  els.ocrTitle.textContent = "等待识别";
  els.aiOcrTitle.textContent = "等待智能识别";
  els.translationTitle.textContent = "等待翻译";
  syncPageControls(false);
  els.ocrMeta.textContent = "未识别";
  els.aiOcrMeta.textContent = "未返回";
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
        raw: result.raw || null,
        compare: normalizeOcrCompare(result.compare),
        lines: Array.isArray(result.lines) ? result.lines : [],
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
      raw: result.raw || null,
      lines: (result.lines || []).map((line, index) => ({
        text: line.text || "",
        bbox: normalizeBbox(line.bbox),
        index,
      })),
      compare: normalizeOcrCompare(result.compare),
      source: result.source || "manual",
      updatedAt: result.updatedAt || "",
    };
  }
  return output;
}

function isValidPageNumber(pageNum) {
  return Number.isInteger(pageNum) && pageNum >= 1 && pageNum <= state.pageCount;
}

function restoreTranslationRoles() {
  let customRoles = [];
  try {
    const raw = window.localStorage.getItem(TRANSLATION_ROLES_KEY);
    customRoles = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(customRoles)) {
      throw new Error("translation roles must be an array");
    }
  } catch (error) {
    console.warn("Failed to restore translation roles", error);
    window.localStorage.removeItem(TRANSLATION_ROLES_KEY);
    setStatus("翻译角色配置已损坏，已回退到内置“学术直译”。", "warn");
    customRoles = [];
  }

  const normalizedCustomRoles = customRoles.map(normalizeTranslationRole).filter(Boolean);
  state.translationRoles = [
    ...BUILT_IN_TRANSLATION_ROLES.map((role) => ({ ...role })),
    ...normalizedCustomRoles,
  ];
  state.activeTranslationRoleId = window.localStorage.getItem(ACTIVE_TRANSLATION_ROLE_KEY) || "academic-literal";
  if (!state.translationRoles.some((role) => role.id === state.activeTranslationRoleId)) {
    state.activeTranslationRoleId = "academic-literal";
    saveActiveTranslationRole();
  }
  state.editingRoleId = state.activeTranslationRoleId;
}

function normalizeTranslationRole(role) {
  if (!role || typeof role !== "object") return null;
  const id = String(role.id || "").trim();
  const name = String(role.name || "").trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    sourceLang: String(role.sourceLang || "bo"),
    targetLang: String(role.targetLang || "zh"),
    model: String(role.model || DEFAULT_TRANSLATION_MODEL),
    systemPrompt: String(role.systemPrompt || BUILT_IN_TRANSLATION_ROLES[0].systemPrompt),
    userPromptTemplate: String(role.userPromptTemplate || BUILT_IN_TRANSLATION_ROLES[0].userPromptTemplate),
    temperature: clamp(Number(role.temperature ?? 0.2), 0, 2),
    maxTokens: Math.max(256, Number(role.maxTokens || 2048)),
    builtIn: false,
  };
}

function getCustomTranslationRoles() {
  return state.translationRoles.filter((role) => !role.builtIn);
}

function saveCustomTranslationRoles() {
  const customRoles = getCustomTranslationRoles().map(({ builtIn, ...role }) => role);
  window.localStorage.setItem(TRANSLATION_ROLES_KEY, JSON.stringify(customRoles));
}

function saveActiveTranslationRole() {
  window.localStorage.setItem(ACTIVE_TRANSLATION_ROLE_KEY, state.activeTranslationRoleId);
}

function getActiveTranslationRole() {
  const role = state.translationRoles.find((item) => item.id === state.activeTranslationRoleId);
  if (role) return role;
  state.activeTranslationRoleId = "academic-literal";
  saveActiveTranslationRole();
  renderTranslationRoleOptions();
  setStatus("当前翻译角色不存在，已回退到内置“学术直译”。", "warn");
  return BUILT_IN_TRANSLATION_ROLES[0];
}

function renderTranslationRoleOptions() {
  if (!els.translationRoleSelect) return;
  els.translationRoleSelect.innerHTML = "";
  state.translationRoles.forEach((role) => {
    const option = document.createElement("option");
    option.value = role.id;
    option.textContent = role.builtIn ? role.name : `${role.name}（自定义）`;
    els.translationRoleSelect.appendChild(option);
  });
  els.translationRoleSelect.value = state.activeTranslationRoleId;
  if (els.translationRoleSelect.value !== state.activeTranslationRoleId) {
    state.activeTranslationRoleId = "academic-literal";
    els.translationRoleSelect.value = state.activeTranslationRoleId;
    saveActiveTranslationRole();
  }
}

function renderActiveTranslationRoleMeta() {
  const role = getActiveTranslationRole();
  if (els.translationRoleModel) {
    els.translationRoleModel.textContent = `模型：${role.model || DEFAULT_TRANSLATION_MODEL}`;
    els.translationRoleModel.title = `${role.name} · ${role.sourceLang} → ${role.targetLang}`;
  }
}

function openRoleManager() {
  state.editingRoleId = state.activeTranslationRoleId;
  renderRoleList();
  loadRoleForm(getActiveTranslationRole());
  els.roleManagerModal.classList.remove("is-hidden");
  window.setTimeout(() => els.roleNameInput.focus(), 0);
  if (window.lucide) window.lucide.createIcons();
}

function closeRoleManager() {
  els.roleManagerModal.classList.add("is-hidden");
}

function renderRoleList() {
  els.roleList.innerHTML = "";
  state.translationRoles.forEach((role) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "role-list-item";
    button.classList.toggle("active", role.id === state.editingRoleId);
    button.innerHTML = `
      <strong>${escapeHtml(role.name)}</strong>
      <span>${escapeHtml(role.model || DEFAULT_TRANSLATION_MODEL)}</span>
      <em>${role.builtIn ? "内置" : "自定义"}</em>
    `;
    button.addEventListener("click", () => {
      state.editingRoleId = role.id;
      renderRoleList();
      loadRoleForm(role);
    });
    els.roleList.appendChild(button);
  });
}

function loadRoleForm(role) {
  const target = role || BUILT_IN_TRANSLATION_ROLES[0];
  els.roleNameInput.value = target.name || "";
  els.roleIdInput.value = target.id || "";
  els.roleSourceLangInput.value = target.sourceLang || "bo";
  els.roleTargetLangInput.value = target.targetLang || "zh";
  els.roleModelInput.value = target.model || DEFAULT_TRANSLATION_MODEL;
  els.roleTemperatureInput.value = String(target.temperature ?? 0.2);
  els.roleMaxTokensInput.value = String(target.maxTokens ?? 2048);
  els.roleSystemPromptInput.value = target.systemPrompt || "";
  els.roleUserPromptTemplateInput.value = target.userPromptTemplate || "";
  els.deleteRoleButton.disabled = Boolean(target.builtIn);
}

function createDraftTranslationRole() {
  state.editingRoleId = "";
  renderRoleList();
  loadRoleForm({
    id: "",
    name: "",
    sourceLang: "bo",
    targetLang: "zh",
    model: DEFAULT_TRANSLATION_MODEL,
    systemPrompt: BUILT_IN_TRANSLATION_ROLES[0].systemPrompt,
    userPromptTemplate: BUILT_IN_TRANSLATION_ROLES[0].userPromptTemplate,
    temperature: 0.2,
    maxTokens: 2048,
    builtIn: false,
  });
}

function saveRoleFromForm(event) {
  event.preventDefault();
  const roleName = els.roleNameInput.value.trim();
  if (!roleName) {
    setStatus("请先填写翻译角色显示名称。", "warn");
    return;
  }

  const currentRole = state.translationRoles.find((role) => role.id === state.editingRoleId);
  const baseId = els.roleIdInput.value.trim() || slugifyRoleId(roleName);
  const roleId = currentRole?.builtIn ? `custom-${baseId}` : baseId;
  const role = normalizeTranslationRole({
    id: ensureUniqueRoleId(roleId, currentRole?.builtIn ? "" : state.editingRoleId),
    name: roleName,
    sourceLang: els.roleSourceLangInput.value,
    targetLang: els.roleTargetLangInput.value,
    model: els.roleModelInput.value.trim() || DEFAULT_TRANSLATION_MODEL,
    systemPrompt: els.roleSystemPromptInput.value.trim(),
    userPromptTemplate: els.roleUserPromptTemplateInput.value.trim(),
    temperature: Number(els.roleTemperatureInput.value || 0.2),
    maxTokens: Number(els.roleMaxTokensInput.value || 2048),
  });
  if (!role) {
    setStatus("翻译角色配置无效，未保存。", "error");
    return;
  }

  const existingIndex = state.translationRoles.findIndex((item) => item.id === state.editingRoleId && !item.builtIn);
  if (existingIndex >= 0) {
    state.translationRoles.splice(existingIndex, 1, role);
  } else {
    state.translationRoles.push(role);
  }
  state.activeTranslationRoleId = role.id;
  state.editingRoleId = role.id;
  saveCustomTranslationRoles();
  saveActiveTranslationRole();
  renderTranslationRoleOptions();
  renderActiveTranslationRoleMeta();
  renderRoleList();
  loadRoleForm(role);
  setStatus(`已保存翻译角色：${role.name}。`, "ok");
}

function deleteEditingTranslationRole() {
  const role = state.translationRoles.find((item) => item.id === state.editingRoleId);
  if (!role || role.builtIn) return;
  state.translationRoles = state.translationRoles.filter((item) => item.id !== role.id);
  if (state.activeTranslationRoleId === role.id) {
    state.activeTranslationRoleId = "academic-literal";
    saveActiveTranslationRole();
  }
  state.editingRoleId = state.activeTranslationRoleId;
  saveCustomTranslationRoles();
  renderTranslationRoleOptions();
  renderActiveTranslationRoleMeta();
  renderRoleList();
  loadRoleForm(getActiveTranslationRole());
  setStatus(`已删除自定义翻译角色：${role.name}。`, "ok");
}

function resetCustomTranslationRoles() {
  state.translationRoles = BUILT_IN_TRANSLATION_ROLES.map((role) => ({ ...role }));
  state.activeTranslationRoleId = "academic-literal";
  state.editingRoleId = "academic-literal";
  window.localStorage.removeItem(TRANSLATION_ROLES_KEY);
  saveActiveTranslationRole();
  renderTranslationRoleOptions();
  renderActiveTranslationRoleMeta();
  renderRoleList();
  loadRoleForm(getActiveTranslationRole());
  setStatus("已重置自定义翻译角色，当前使用“学术直译”。", "ok");
}

function ensureUniqueRoleId(roleId, currentId = "") {
  let nextId = roleId;
  let suffix = 2;
  while (state.translationRoles.some((role) => role.id === nextId && role.id !== currentId)) {
    nextId = `${roleId}-${suffix}`;
    suffix += 1;
  }
  return nextId;
}

function slugifyRoleId(value) {
  const ascii = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `custom-role-${Date.now()}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isDirectTextSource(source) {
  return DIRECT_TEXT_SOURCES.has(source || "");
}

function splitTextIntoLineRecords(text) {
  return String(text || "")
    .split("\n")
    .map((line, index) => ({ text: line, bbox: null, index }));
}

function makeTextResult(text, source, extra = {}) {
  return {
    text,
    lines: splitTextIntoLineRecords(text),
    source,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

function shouldReplaceExistingWithPdfText(existing, existingText, overwrite) {
  if (overwrite) return true;
  if (!existingText) return true;
  if (existing?.source === "manual") return false;
  return !isDirectTextSource(existing?.source);
}

function getResultSourceLabel(result) {
  switch (result?.source) {
    case "pdf-text":
      return "PDF 文本层";
    case "word-text":
      return "Word 文本";
    case "markdown":
      return "Markdown 文本";
    case "text-file":
      return "文本文件";
    case "manual":
      return "人工校对文本";
    case "bdrc":
      return "BDRC OCR";
    case "ai-vision":
      return "AI Vision";
    case "bdrc-ai":
      return "智能识别";
    default:
      return result?.text ? "校对文本" : "";
  }
}

async function renderCurrentPage() {
  if (!state.pageCount) {
    return;
  }

  if (state.sourceType === "image") {
    renderImagePage();
    return;
  }

  if (state.sourceType === "markdown" || state.sourceType === "text" || state.sourceType === "word") {
    renderTextDocumentPage();
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
  syncPageControls(true);
  renderActiveSourceHighlight();
  updateOcrPanelForPage();
  updateTranslationPanelForPage();
  updateThumbnailState();
}

function renderImagePage() {
  els.pdfCanvas.style.display = "none";
  els.imagePage.style.display = "block";
  els.emptyState.style.display = "none";
  syncPageControls(true);
  renderActiveSourceHighlight();
  updateOcrPanelForPage();
  updateTranslationPanelForPage();
  updateThumbnailState();
}

function renderTextDocumentPage() {
  const label = state.sourceType === "word"
    ? "Word"
    : state.sourceType === "text"
      ? "文本"
      : "Markdown";
  const text = state.documentText || state.markdownText || "";
  els.pdfCanvas.style.display = "none";
  els.imagePage.style.display = "none";
  els.emptyState.style.display = "grid";
  els.emptyState.innerHTML = `
    <i data-lucide="file-text"></i>
    <p>已载入 ${label} 文本，请在中栏校对内容。</p>
    <pre class="markdown-source-preview">${escapeHtml(text.slice(0, 2400))}</pre>
  `;
  if (window.lucide) {
    window.lucide.createIcons();
  }
  syncPageControls(true);
  clearSourceLineHighlight();
  updateOcrPanelForPage();
  updateTranslationPanelForPage();
  updateThumbnailState();
}

async function buildPdfThumbnails() {
  els.thumbnailList.innerHTML = "";

  const count = state.pageCount;
  const token = ++state.thumbnailToken;
  let nextPage = 1;

  const appendChunk = (deadline) => {
    if (!state.pdfDoc || token !== state.thumbnailToken) return;

    const fragment = document.createDocumentFragment();
    let appended = 0;

    while (
      nextPage <= count &&
      appended < 48 &&
      (!deadline || deadline.timeRemaining() > 4 || appended < 8)
    ) {
      const button = createThumbnailButton(nextPage);
      fragment.appendChild(button);
      nextPage += 1;
      appended += 1;
    }

    els.thumbnailList.appendChild(fragment);

    updateThumbnailState();

    if (nextPage <= count) {
      scheduleIdleWork(appendChunk);
    }
  };

  appendChunk();
}

function createThumbnailButton(pageNum) {
  const button = document.createElement("button");
  button.className = "thumbnail-button";
  button.type = "button";
  button.dataset.page = String(pageNum);
  button.innerHTML = `<span class="page-nav-number">${pageNum}</span>`;
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

function buildImageThumbnail() {
  els.thumbnailList.innerHTML = "";
  const button = document.createElement("button");
  button.className = "thumbnail-button active";
  button.type = "button";
  button.dataset.page = "1";
  const span = document.createElement("span");
  span.textContent = "1";
  span.className = "page-nav-number";
  button.append(span);
  els.thumbnailList.appendChild(button);
}

function buildMarkdownThumbnail() {
  buildTextThumbnail("MD");
}

function buildTextThumbnail(label) {
  els.thumbnailList.innerHTML = "";
  const button = document.createElement("button");
  button.className = "thumbnail-button active recognized direct-text";
  button.type = "button";
  button.dataset.page = "1";
  button.innerHTML = `<span class="page-nav-type">${escapeHtml(label)}</span><span class="page-nav-number">1</span>`;
  els.thumbnailList.appendChild(button);
}

async function goToPage(pageNum) {
  if (!state.pageCount) return;
  const nextPage = clamp(Math.trunc(pageNum), 1, state.pageCount);
  if (nextPage === state.pageNum) {
    syncPageControls(true);
    return;
  }
  state.pageNum = nextPage;
  clearSourceLineHighlight();
  await renderCurrentPage();
  await primeCurrentPageDirectText("page");
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

  if (state.sourceType === "pdf") {
    try {
      const directText = await ensureCurrentPageDirectText({ overwrite: true, updatePanel: true });
      if (directText.text) {
        setOcrView("lines");
        setStatus(`第 ${state.pageNum} 页是可编辑文字 PDF，已直接提取文本，未调用 OCR。`, "ok");
        return;
      }
    } catch (error) {
      setStatus(`PDF 文本层提取失败，改用 OCR：${error.message || error}`, "warn");
    }
  }

  const endpoint = els.endpointInput.value.trim();
  const aiEndpoint = els.aiOcrEndpointInput.value.trim();
  const mode = getOcrMode();

  if ((mode === "bdrc" || mode === "smart") && !endpoint) {
    setStatus("请填写 BDRC OCR 接口地址。", "warn");
    return;
  }
  if (mode === "ai" && !aiEndpoint) {
    setStatus("请填写 AI Vision OCR 接口地址。", "warn");
    return;
  }

  try {
    setBusy(true);
    setStatus(`正在生成第 ${state.pageNum} 页 OCR 图片...`, "warn");
    const blob = await getCurrentPageImageBlob();

    if (mode === "ai") {
      setStatus("正在调用 AI Vision OCR 接口...", "warn");
      const aiParsed = await callOcrEndpoint(aiEndpoint, blob, {
        engine: "ai_vision",
        mode: "ai",
        prompt: buildAiOcrPrompt(""),
      });
      saveOcrResultFromParsed(aiParsed, "ai-vision", "第 " + state.pageNum + " 页 AI Vision 识别完成。");
      return;
    }

    setStatus("正在调用本地 BDRC OCR 接口...", "warn");
    let bdrcParsed;
    try {
      bdrcParsed = await callOcrEndpoint(endpoint, blob, {
        engine: "bdrc",
        mode,
      });
    } catch (error) {
      if (mode !== "smart" || !aiEndpoint) {
        throw error;
      }
      setStatus(`BDRC 未返回有效结果，正在改用 AI Vision：${formatNetworkError(error, endpoint)}`, "warn");
      let aiParsed;
      try {
        aiParsed = await callOcrEndpoint(aiEndpoint, blob, {
          engine: "ai_vision",
          mode: "smart-fallback",
          prompt: buildAiOcrPrompt(""),
        });
      } catch (aiError) {
        throw new Error(`AI Vision 调用失败：${formatNetworkError(aiError, aiEndpoint, "ai-ocr")}`);
      }
      saveOcrResultFromParsed(
        aiParsed,
        "ai-vision",
        `第 ${state.pageNum} 页智能识别完成：BDRC 无有效结果，已使用 AI Vision。`
      );
      return;
    }

    if (mode === "bdrc") {
      saveOcrResultFromParsed(bdrcParsed, "bdrc", `第 ${state.pageNum} 页 BDRC 识别完成。`);
      return;
    }

    const bdrcText = bdrcParsed.text.trim();
    if (!aiEndpoint) {
      saveSmartOcrCompareResult({
        bdrcParsed,
        aiError: "未填写 AI Vision OCR 接口，未调用智能识别。",
        statusMessage: `第 ${state.pageNum} 页 BDRC 识别完成；未填写 AI Vision 接口，已跳过 LLM 校正。`,
        statusType: "warn",
      });
      return;
    }

    try {
      setStatus("BDRC 完成，正在调用 AI Vision 校正高危藏文字母...", "warn");
      const aiParsed = await callOcrEndpoint(aiEndpoint, blob, {
        engine: "ai_vision",
        mode: "smart",
        ocr_text: bdrcText,
        high_risk_clusters: JSON.stringify(getUniqueHighRiskClustersFromText(bdrcText)),
        prompt: buildAiOcrPrompt(bdrcText),
      });
      const aiText = getParsedOcrText(aiParsed);
      const bdrcLineCount = countTextLines(bdrcText);
      const aiLineCount = countParsedOcrLines(aiParsed);
      const aiPartial = Boolean(aiText && bdrcLineCount && aiLineCount < bdrcLineCount);
      saveSmartOcrCompareResult({
        bdrcParsed,
        aiParsed,
        aiError: aiText ? "" : "AI Vision 接口调用成功，但响应中没有可用文本。",
        statusMessage: aiText
          ? aiPartial
            ? `第 ${state.pageNum} 页智能识别完成，但 AI Vision 仅返回 ${aiLineCount}/${bdrcLineCount} 行，请重新识别或检查模型输出。`
            : `第 ${state.pageNum} 页智能识别完成：BDRC + LLM 校正。`
          : `第 ${state.pageNum} 页 BDRC 识别完成；AI Vision 返回为空。`,
        statusType: aiText && !aiPartial ? "ok" : "warn",
      });
    } catch (error) {
      const reason = formatNetworkError(error, aiEndpoint, "ai-ocr");
      saveSmartOcrCompareResult({
        bdrcParsed,
        aiError: `AI Vision 调用失败：${reason}`,
        statusMessage: `第 ${state.pageNum} 页 BDRC 识别完成；AI Vision 校正失败：${reason}`,
        statusType: "warn",
      });
    }
  } catch (error) {
    setStatus(
      `OCR 调用失败：${formatNetworkError(error, mode === "ai" ? aiEndpoint : endpoint, mode === "ai" ? "ai-ocr" : "ocr")}`,
      "error"
    );
  } finally {
    setBusy(false);
  }
}

function getOcrMode() {
  return els.ocrModeSelect?.value || "smart";
}

async function callOcrEndpoint(endpoint, blob, fields = {}) {
  const formData = new FormData();
  formData.append("file", blob, makePageImageName());
  formData.append("lang", "bo");
  formData.append("page", String(state.pageNum));
  formData.append("source_name", state.sourceName);
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      formData.append(key, String(value));
    }
  });

  const response = await fetch(endpoint, { method: "POST", body: formData });
  const parsed = await parseOcrResponse(response);
  if (!response.ok) {
    throw new Error(parsed.error || `HTTP ${response.status}`);
  }
  return parsed;
}

function saveOcrResultFromParsed(parsed, source, statusMessage, fallbackLines = [], preferredView = "lines") {
  const text = getParsedOcrText(parsed);
  const rawLines = getParsedOcrLines(parsed);
  const lines = rawLines.length ? rawLines : makeOcrLinesFromText(text, fallbackLines);
  const compare = normalizeOcrCompare(parsed.compare);
  state.ocrResults.set(state.pageNum, {
    text,
    raw: parsed.raw,
    compare,
    lines,
    source,
    updatedAt: new Date().toISOString(),
  });
  saveCachedResults();
  els.ocrText.value = text;
  setOcrView(preferredView === "compare" && compare ? "compare" : "lines");
  const statusType = statusMessage.includes("失败") || statusMessage.includes("未填写") ? "warn" : "ok";
  setStatus(statusMessage, statusType);
  updateOcrPanelForPage();
  updateSummary();
  updateThumbnailState();
}

function saveSmartOcrCompareResult({ bdrcParsed, aiParsed = null, aiError = "", statusMessage, statusType = "ok" }) {
  const bdrcText = getParsedOcrText(bdrcParsed);
  const bdrcRawLines = getParsedOcrLines(bdrcParsed);
  const bdrcLines = bdrcRawLines.length ? bdrcRawLines : makeOcrLinesFromText(bdrcText);
  const aiText = getParsedOcrText(aiParsed);
  const aiRawLines = getParsedOcrLines(aiParsed);
  const aiModel = getOcrResponseModel(aiParsed?.raw);
  const aiProvider = getOcrResponseProvider(aiParsed?.raw);
  const hasAiContent = Boolean(aiText || aiRawLines.some((line) => String(line?.text || "").trim()));
  const aiLines = hasAiContent
    ? (aiRawLines.length ? aiRawLines : makeOcrLinesFromText(aiText))
    : [{
        text: aiError || "AI Vision 未返回文本。",
        bbox: null,
        index: 0,
        error: true,
      }];
  const result = {
    raw: {
      source: "smart",
      bdrc: bdrcParsed.raw,
      ai: aiParsed?.raw || null,
      ai_error: aiError || "",
    },
    text: aiText || bdrcText,
    compare: {
      note: aiError
        ? "右栏 AI Vision / LLM 未返回可用文本，已显示失败原因；左栏 BDRC 初稿仍可继续人工校对。"
        : "左栏为 BDRC OCR 初稿，右栏为 AI Vision / LLM 识别或复核结果。",
      bdrc: {
        label: "BDRC",
        text: bdrcText,
        lines: bdrcLines,
      },
      llm: {
        label: "AI Vision / LLM",
        text: aiText,
        lines: aiLines,
        error: Boolean(aiError),
        model: aiModel,
        provider: aiProvider,
        expectedLineCount: countNonEmptyOcrLines(bdrcLines),
        returnedLineCount: hasAiContent ? countNonEmptyOcrLines(aiLines) : 0,
      },
    },
  };
  saveOcrResultFromParsed(result, "bdrc-ai", statusMessage, bdrcLines, "compare");
  if (statusType !== "ok") {
    setStatus(statusMessage, statusType);
  }
}

function makeOcrLinesFromText(text, fallbackLines = []) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeOcrTextSpacing(line.trim()))
    .filter(Boolean)
    .map((line, index) => ({
      text: line,
      bbox: fallbackLines[index]?.bbox || null,
      index,
    }));
}

function countNonEmptyOcrLines(lines) {
  return (lines || []).filter((line) => String(line?.text || "").trim()).length;
}

function countTextLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .length;
}

function countParsedOcrLines(parsed) {
  const rawLines = getParsedOcrLines(parsed);
  return rawLines.length ? countNonEmptyOcrLines(rawLines) : countTextLines(parsed?.text || "");
}

function getParsedOcrLines(parsed) {
  return parsed?.raw
    ? extractOcrLines(parsed.raw).map((line) => ({
        ...line,
        text: normalizeOcrTextSpacing(line?.text || ""),
      }))
    : [];
}

function getParsedOcrText(parsed) {
  if (!parsed) return "";
  const text = normalizeOcrTextSpacing(String(parsed.text || "").trim());
  if (text) return text;
  return getParsedOcrLines(parsed)
    .map((line) => line.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function getOcrResponseModel(raw) {
  if (!raw || typeof raw !== "object") return "";
  return String(raw.model || raw.modelRef || raw.model_ref || raw.raw?.model || raw.raw?.modelRef || "").trim();
}

function getOcrResponseProvider(raw) {
  if (!raw || typeof raw !== "object") return "";
  return String(raw.provider || raw.raw?.provider || "").trim();
}

function normalizeOcrCompare(compare) {
  if (!compare || typeof compare !== "object") return null;
  const bdrc = normalizeOcrCompareSide(compare.bdrc || compare.bdrC || compare.left);
  const llm = normalizeOcrCompareSide(compare.llm || compare.ai || compare.right);
  if (!bdrc.text && !llm.text) return null;
  return { note: String(compare.note || ""), bdrc, llm };
}

function normalizeOcrCompareSide(side) {
  if (!side || typeof side !== "object") {
    return { label: "", text: "", lines: [] };
  }
  const lines = Array.isArray(side.lines)
    ? side.lines.map((line, index) => {
        if (typeof line === "string") {
          return { text: normalizeOcrTextSpacing(line), bbox: null, index };
        }
        return {
          text: normalizeOcrTextSpacing(line?.text || line?.content || line?.value || ""),
          bbox: normalizeBbox(line?.bbox || line?.box || line?.bounding_box),
          index,
          error: Boolean(line?.error),
          missing: Boolean(line?.missing),
          diagnostic: Boolean(line?.diagnostic),
        };
      })
    : [];
  const lineText = lines.map((line) => line.text || "").filter(Boolean).join("\n").trim();
  const text = String(
    side.text ||
    side.ocr_text ||
    side.ocrText ||
    side.markdown ||
    side.answer ||
    side.content ||
    side.output ||
    lineText ||
    ""
  ).trim();
  const normalizedText = normalizeOcrTextSpacing(text);
  return {
    label: String(side.label || ""),
    text: normalizedText,
    lines: lines.length ? lines : makeOcrLinesFromText(normalizedText),
    error: Boolean(side.error),
    model: String(side.model || ""),
    provider: String(side.provider || ""),
    expectedLineCount: Number(side.expectedLineCount || 0),
    returnedLineCount: Number(side.returnedLineCount || 0),
  };
}

function getUniqueHighRiskClustersFromText(text) {
  const seen = new Set();
  return getHighRiskClusterScan(text)
    .filter((cluster) => cluster.highRisk)
    .map((cluster) => cluster.text)
    .filter((cluster) => {
      if (seen.has(cluster)) return false;
      seen.add(cluster);
      return true;
    });
}

function buildAiOcrPrompt(bdrcText) {
  const bdrcLineCount = countTextLines(bdrcText);
  return [
    "请识别图片中的藏文印刷体文字。",
    "重点检查上加字、下加字、元音符号和堆叠字，不要根据语义自由扩写。",
    "如果提供了 BDRC OCR 文本，请只在图像证据支持时修正它。",
    bdrcLineCount
      ? `BDRC OCR 初稿共有 ${bdrcLineCount} 行。请必须输出 ${bdrcLineCount} 行，用换行逐行分隔；不得只输出前几行。看不清或无法确认的行，请保留 BDRC 原行，只修正有图像证据的字。`
      : "请完整输出整页所有藏文行，用换行逐行分隔；不得只输出前几行。",
    "只输出纯藏文文本，不要输出编号、解释、Markdown 表格或代码块。",
    bdrcText ? `BDRC OCR 初稿：\n${bdrcText}` : "",
  ].filter(Boolean).join("\n\n");
}

async function extractCurrentPdfPageText() {
  if (!state.pdfDoc) return { text: "", raw: null, lines: [] };
  const page = await state.pdfDoc.getPage(state.pageNum);
  const content = await page.getTextContent();
  const items = Array.isArray(content.items) ? content.items : [];
  const rows = groupPdfTextItemsIntoLines(items);
  const text = rows.map((row) => row.text).filter(Boolean).join("\n").trim();
  return {
    text,
    raw: { source: "pdf-text", items, page: state.pageNum },
    lines: rows.map((row, index) => ({ text: row.text, bbox: null, index })),
  };
}

async function primeCurrentPageDirectText(mode = "silent") {
  if (state.sourceType !== "pdf") return null;

  try {
    const directText = await ensureCurrentPageDirectText({ updatePanel: true });
    if (!directText?.text) {
      if (mode === "load") {
        setStatus(`已载入 ${state.sourceName}，第 1 页未发现可直接提取文本；如果是扫描件，请点“识别”。`, "warn");
      }
      return directText;
    }

    if (mode === "load") {
      setStatus(`已识别源文档属性：可编辑文字 PDF。已直接提取第 1 页文本，可直接翻译，无需 OCR。`, "ok");
    } else if (mode === "page" && directText.persisted) {
      setStatus(`第 ${state.pageNum} 页已从 PDF 文本层直接提取，可直接翻译。`, "ok");
    }
    return directText;
  } catch (error) {
    if (mode === "load") {
      setStatus(`已载入 PDF，但文本层检查失败：${error.message || error}。可继续使用 OCR。`, "warn");
    }
    return null;
  }
}

async function ensureCurrentPageDirectText(options = {}) {
  const { overwrite = false, updatePanel = false } = options;
  const existing = state.ocrResults.get(state.pageNum);
  const existingText = (existing?.text || "").trim();

  if (!overwrite && existing?.source === "manual" && existingText) {
    return {
      text: existingText,
      source: "manual",
      label: getResultSourceLabel(existing),
      persisted: false,
      fromExisting: true,
    };
  }

  if (state.sourceType !== "pdf") {
    if (existingText && isDirectTextSource(existing?.source)) {
      return {
        text: existingText,
        source: existing.source,
        label: getResultSourceLabel(existing),
        persisted: false,
        fromExisting: true,
      };
    }
    return { text: "", source: "", label: "", persisted: false };
  }

  if (!overwrite && existing?.source === "pdf-text" && existingText) {
    return {
      text: existingText,
      source: "pdf-text",
      label: getResultSourceLabel(existing),
      persisted: false,
      fromExisting: true,
    };
  }

  const pdfTextResult = await extractCurrentPdfPageText();
  if (!pdfTextResult.text) {
    return { text: "", source: "pdf-text", label: "PDF 文本层", persisted: false };
  }

  const shouldPersist = shouldReplaceExistingWithPdfText(existing, existingText, overwrite);

  if (shouldPersist) {
    state.ocrResults.set(state.pageNum, {
      text: pdfTextResult.text,
      raw: pdfTextResult.raw,
      lines: pdfTextResult.lines,
      source: "pdf-text",
      updatedAt: new Date().toISOString(),
    });
    saveCachedResults();
    if (updatePanel) {
      els.ocrText.value = pdfTextResult.text;
      updateOcrPanelForPage();
      updateSummary();
      updateThumbnailState();
    }
  }

  return {
    text: pdfTextResult.text,
    source: "pdf-text",
    label: "PDF 文本层",
    persisted: shouldPersist,
  };
}

function groupPdfTextItemsIntoLines(items) {
  const rows = [];
  items.forEach((item) => {
    const text = String(item.str || "").trim();
    if (!text) return;
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const y = Number(transform[5] || 0);
    const x = Number(transform[4] || 0);
    let row = rows.find((candidate) => Math.abs(candidate.y - y) < 4);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, text });
  });

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => ({
      text: row.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join("")
        .trim(),
    }))
    .filter((row) => row.text);
}

async function extractDocxText(file) {
  const buffer = await file.arrayBuffer();
  const documentXmlBytes = await readZipEntry(buffer, "word/document.xml");
  const xml = new TextDecoder("utf-8").decode(documentXmlBytes);
  return extractTextFromDocxXml(xml);
}

async function readZipEntry(buffer, expectedName) {
  const view = new DataView(buffer);
  const decoder = new TextDecoder("utf-8");
  const eocdOffset = findZipEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("DOCX ZIP central directory is invalid");
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));

    if (name === expectedName) {
      return extractZipLocalFile(buffer, localHeaderOffset, method, compressedSize);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`DOCX 中缺少 ${expectedName}`);
}

function findZipEndOfCentralDirectory(view) {
  const minOffset = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("DOCX ZIP end record not found");
}

async function extractZipLocalFile(buffer, localHeaderOffset, method, compressedSize) {
  const view = new DataView(buffer);
  if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
    throw new Error("DOCX ZIP local file header is invalid");
  }

  const nameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataOffset = localHeaderOffset + 30 + nameLength + extraLength;
  const data = new Uint8Array(buffer, dataOffset, compressedSize);

  if (method === 0) {
    return data;
  }
  if (method === 8) {
    return inflateZipDeflate(data);
  }
  throw new Error(`DOCX 压缩格式不支持：${method}`);
}

async function inflateZipDeflate(data) {
  if (!("DecompressionStream" in window)) {
    throw new Error("当前浏览器不支持 DOCX 解压，请先转为 PDF 或 Markdown。");
  }

  const formats = ["deflate-raw", "deflate"];
  let lastError = null;
  for (const format of formats) {
    try {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream(format));
      const buffer = await new Response(stream).arrayBuffer();
      return new Uint8Array(buffer);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`DOCX 解压失败：${lastError?.message || lastError || "unknown error"}`);
}

function extractTextFromDocxXml(xml) {
  const documentXml = new DOMParser().parseFromString(xml, "application/xml");
  if (documentXml.getElementsByTagName("parsererror").length) {
    throw new Error("DOCX XML 解析失败");
  }

  const paragraphs = Array.from(documentXml.getElementsByTagNameNS("*", "p"));
  const lines = paragraphs
    .map((paragraph) => extractDocxParagraphText(paragraph).trim())
    .filter(Boolean);

  return lines.join("\n").trim();
}

function extractDocxParagraphText(paragraph) {
  const parts = [];
  const walk = (node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const localName = node.localName;
      if (localName === "t") {
        parts.push(node.textContent || "");
        return;
      }
      if (localName === "tab") {
        parts.push("\t");
        return;
      }
      if (localName === "br" || localName === "cr") {
        parts.push("\n");
        return;
      }
    }
    node.childNodes.forEach(walk);
  };
  walk(paragraph);
  return parts.join("");
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
      if (payload.provider === "model_aggregator") {
        setStatus(`藏译汉服务可用，模型聚合服务已连接，当前模型：${model}。`, "ok");
      } else {
        setStatus(`藏译汉服务可用，当前模型：${model}。`, "ok");
      }
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

  if (state.sourceType === "pdf") {
    setStatus(`正在检查第 ${state.pageNum} 页 PDF 文本层...`, "warn");
  }
  const sourceInput = await resolveCurrentSourceTextForTranslation();
  if (!sourceInput.text) {
    const message = state.sourceType === "pdf"
      ? "当前 PDF 页没有可提取文本，也没有 OCR/人工校对文本；如果是扫描件，请先点“识别”。"
      : "当前页还没有可翻译文本，请先导入文本、识别 OCR 或手动粘贴校对文本。";
    setStatus(message, "warn");
    return;
  }

  const role = getActiveTranslationRole();

  try {
    setTranslateBusy(true);
    const ready = await ensureTranslateReady(endpoint);
    if (!ready) {
      return;
    }
    setStatus(`正在翻译第 ${state.pageNum} 页${sourceInput.label || "源文本"}...`, "warn");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: sourceInput.text,
        source_text: sourceInput.text,
        source_kind: sourceInput.source,
        source_label: sourceInput.label,
        source_lang: role.sourceLang || "bo",
        target_lang: role.targetLang || "zh",
        src_lang: "bod_Tibt",
        tgt_lang: "zho_Hans",
        page: state.pageNum,
        source_name: state.sourceName,
        role_id: role.id,
        role_name: role.name,
        system_prompt: role.systemPrompt,
        user_prompt_template: role.userPromptTemplate,
        model: role.model || DEFAULT_TRANSLATION_MODEL,
        temperature: Number(role.temperature ?? 0.2),
        max_tokens: Number(role.maxTokens ?? 2048),
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
      roleId: role.id,
      roleName: role.name,
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

async function resolveCurrentSourceTextForTranslation() {
  const result = state.ocrResults.get(state.pageNum);
  const editorText = (els.ocrText.value || "").trim();

  if (result?.source === "manual" && editorText) {
    return {
      text: editorText,
      source: "manual",
      label: getResultSourceLabel(result),
    };
  }

  if (state.sourceType === "pdf") {
    try {
      const directText = await ensureCurrentPageDirectText({ updatePanel: true });
      if (directText.text) {
        return directText;
      }
    } catch (error) {
      setStatus(`PDF 文本层提取失败，回落 OCR/校对文本：${error.message || error}`, "warn");
    }
  }

  const fallbackText = editorText || (result?.text || "").trim();
  if (fallbackText) {
    return {
      text: fallbackText,
      source: result?.source || "ocr",
      label: getResultSourceLabel(result) || "OCR/校对文本",
    };
  }

  return { text: "", source: "", label: "" };
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

  const direct = (
    payload.text ||
    payload.ocr_text ||
    payload.ocrText ||
    payload.result_text ||
    payload.resultText ||
    payload.full_text ||
    payload.fullText ||
    payload.markdown ||
    payload.answer ||
    payload.content ||
    payload.value ||
    payload.output
  );
  if (typeof direct === "string") return direct;

  const choiceText = extractOpenAiChoiceText(payload.choices);
  if (choiceText) return choiceText;

  const candidateText = extractGeminiCandidateText(payload.candidates);
  if (candidateText) return candidateText;

  if (payload.result) {
    const nested = extractTextFromJson(payload.result);
    if (nested) return nested;
  }

  for (const key of ["data", "response", "payload", "output"]) {
    if (payload[key] && typeof payload[key] === "object") {
      const nested = extractTextFromJson(payload[key]);
      if (nested) return nested;
    }
  }

  const lines = payload.lines || payload.blocks || payload.items;
  if (Array.isArray(lines)) {
    const text = lines
      .map((line) => {
        if (typeof line === "string") return line;
        return line.text || line.ocr_text || line.ocrText || line.content || line.value || "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }

  return JSON.stringify(payload, null, 2);
}

function extractOpenAiChoiceText(choices) {
  if (!Array.isArray(choices)) return "";
  const chunks = [];
  choices.forEach((choice) => {
    if (!choice || typeof choice !== "object") return;
    const message = choice.message || choice.delta || {};
    const content = message.content || choice.text || "";
    if (typeof content === "string") {
      chunks.push(content);
      return;
    }
    if (Array.isArray(content)) {
      content.forEach((part) => {
        if (typeof part === "string") {
          chunks.push(part);
        } else if (part && typeof part.text === "string") {
          chunks.push(part.text);
        }
      });
    }
  });
  return chunks.join("\n").trim();
}

function extractGeminiCandidateText(candidates) {
  if (!Array.isArray(candidates)) return "";
  const chunks = [];
  candidates.forEach((candidate) => {
    const parts = candidate?.content?.parts || candidate?.parts || [];
    if (!Array.isArray(parts)) return;
    parts.forEach((part) => {
      if (typeof part === "string") {
        chunks.push(part);
      } else if (part && typeof part.text === "string") {
        chunks.push(part.text);
      }
    });
  });
  return chunks.join("\n").trim();
}

function extractOcrLines(payload) {
  if (!payload || typeof payload === "string") return [];
  const candidates = payload.lines || payload.blocks || payload.items;
  if (!Array.isArray(candidates)) {
    for (const key of ["result", "data", "response", "payload", "output"]) {
      if (payload[key] && typeof payload[key] === "object") {
        const nested = extractOcrLines(payload[key]);
        if (nested.length) return nested;
      }
    }
    return [];
  }

  return candidates
    .map((line, index) => {
      if (typeof line === "string") {
        return { text: line, image: "", index };
      }
      return {
        text: line?.text || line?.ocr_text || line?.ocrText || line?.content || line?.value || "",
        bbox: normalizeBbox(line?.bbox || line?.box || line?.bounding_box),
        index,
        error: Boolean(line?.error),
        missing: Boolean(line?.missing),
        diagnostic: Boolean(line?.diagnostic),
      };
    })
    .filter((line) => line.text || line.bbox);
}

function normalizeBbox(bbox) {
  if (!bbox || typeof bbox !== "object") return null;
  const x = Number(bbox.x);
  const y = Number(bbox.y);
  const width = Number(bbox.width ?? bbox.w);
  const height = Number(bbox.height ?? bbox.h);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    width: clamp(width, 0, Math.max(0, 1 - clamp(x, 0, 1))),
    height: clamp(height, 0, Math.max(0, 1 - clamp(y, 0, 1))),
  };
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

async function copyCurrentAiText() {
  const text = getCurrentAiOcrText();
  if (!text.trim()) {
    setStatus("当前页没有 AI Vision OCR 文本可复制。", "warn");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus("当前页 AI Vision OCR 文本已复制。", "ok");
  } catch {
    setStatus("浏览器剪贴板不可用，请在 AI Vision 栏手动选择复制。", "warn");
  }
}

function getCurrentAiOcrText() {
  const result = state.ocrResults.get(state.pageNum);
  const compare = getOcrSourceCompare(result);
  if (compare?.llm?.text) return compare.llm.text;
  if (result?.source === "ai-vision") return result.text || "";
  return "";
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
  state.ocrView = view === "text"
    ? "text"
    : view === "compare"
      ? "compare"
      : view === "proofread"
        ? "proofread"
        : "lines";
  const showLines = state.ocrView === "lines";
  const showCompare = state.ocrView === "compare";
  const showProofread = state.ocrView === "proofread";
  const showText = state.ocrView === "text";
  els.workspace.classList.toggle("proofread-merged-view", showProofread);
  els.ocrPaneEyebrow.textContent = showProofread ? "OCR 校对结果" : "BDRC OCR 结果";
  els.ocrLineCompare.classList.toggle("proofread-block-list", showProofread);
  els.ocrLineCompare.classList.toggle("is-hidden", showText);
  els.ocrText.classList.toggle("is-hidden", !showText);
  els.proofreadViewButton.classList.toggle("active", showProofread);
  els.compareViewButton.classList.toggle("active", showCompare);
  els.lineViewButton.classList.toggle("active", showLines);
  els.textViewButton.classList.toggle("active", showText);
  els.proofreadViewButton.setAttribute("aria-pressed", String(showProofread));
  els.compareViewButton.setAttribute("aria-pressed", String(showCompare));
  els.lineViewButton.setAttribute("aria-pressed", String(showLines));
  els.textViewButton.setAttribute("aria-pressed", String(showText));
  if (showProofread) {
    renderProofreadMergedView();
  } else if (showCompare) {
    renderOcrSourceCompareOnly();
  } else if (showLines) {
    renderOcrLineComparison();
  } else {
    clearSourceLineHighlight();
  }
  renderAiOcrPanelForPage();
}

function renderCurrentOcrView() {
  if (state.ocrView === "text") {
    clearSourceLineHighlight();
    renderAiOcrPanelForPage();
    return;
  }
  if (state.ocrView === "proofread") {
    renderProofreadMergedView();
    return;
  }
  if (state.ocrView === "compare") {
    renderOcrSourceCompareOnly();
    return;
  }
  renderOcrLineComparison();
}

function renderOcrSourceCompareOnly() {
  els.ocrLineCompare.innerHTML = "";
  els.ocrLineCompare.classList.remove("proofread-block-list");
  const compare = getCurrentOcrCompareOrEmpty();
  renderOcrSourceSide(els.ocrLineCompare, compare.bdrc, compare.llm, "bdrc");
  renderAiOcrPanelForPage(compare);
}

function renderOcrLineComparison() {
  els.ocrLineCompare.innerHTML = "";
  els.ocrLineCompare.classList.remove("proofread-block-list");
  if (!state.pageCount) {
    renderAiOcrPanelForPage();
    return;
  }

  const result = state.ocrResults.get(state.pageNum);
  const sourceCompare = getOcrSourceCompare(result);
  if (sourceCompare) {
    renderOcrSourceSide(els.ocrLineCompare, sourceCompare.bdrc, sourceCompare.llm, "bdrc");
    renderAiOcrPanelForPage(sourceCompare);
    return;
  }

  renderAiOcrPanelForPage();
  const lines = result?.lines || extractOcrLines(result?.raw);
  if (!lines?.length) {
    const empty = document.createElement("div");
    empty.className = "line-compare-empty";
    empty.innerHTML = result?.text
      ? "<strong>当前结果没有行坐标</strong><span>可切换到“文本”继续校对；重新识别当前页后可点击藏文定位原文。</span>"
      : "<strong>等待 OCR 识别</strong><span>识别完成后，这里会按行显示可编辑藏文；点击某行可在原页定位。</span>";
    els.ocrLineCompare.appendChild(empty);
    return;
  }

  lines.forEach((line, index) => {
    const row = document.createElement("section");
    row.className = "ocr-line-row";
    row.dataset.sourceRowIndex = String(index);
    row.dataset.sourceSide = "bdrc";
    row.classList.toggle("is-active", state.activeOcrLine === index);

    const rowHeader = document.createElement("div");
    rowHeader.className = "ocr-line-number";
    rowHeader.textContent = String(index + 1).padStart(2, "0");

    const content = document.createElement("div");
    content.className = "ocr-line-content";

    const preview = document.createElement("div");
    preview.className = "ocr-line-preview";
    renderOcrLineMarkup(preview, line.text || "");

    const editor = document.createElement("textarea");
    editor.className = "ocr-line-editor";
    editor.rows = 1;
    editor.spellcheck = false;
    editor.value = line.text || "";
    editor.setAttribute("aria-label", `第 ${index + 1} 行 OCR 文本`);
    const activateLine = () => activateOcrLine(line, index, row);
    row.addEventListener("click", activateLine);
    editor.addEventListener("focus", activateLine);
    editor.addEventListener("input", () => {
      line.text = editor.value || "";
      renderOcrLineMarkup(preview, line.text);
      resizeLineEditor(editor);
      syncLineEditorsToResult(lines);
    });

    content.appendChild(preview);
    content.appendChild(editor);
    row.append(rowHeader, content);
    els.ocrLineCompare.appendChild(row);
    resizeLineEditor(editor);
  });
}

function renderAiOcrPanelForPage(compare = null) {
  if (!els.aiOcrLineCompare) return;
  const sourceCompare = compare || getCurrentOcrCompareOrEmpty();
  renderOcrSourceSide(els.aiOcrLineCompare, sourceCompare.llm, sourceCompare.bdrc, "llm");
  updateAiOcrPanelMeta(sourceCompare);
}

function renderProofreadMergedView() {
  els.ocrLineCompare.innerHTML = "";
  els.ocrLineCompare.classList.add("proofread-block-list");

  if (!state.pageCount) {
    const empty = document.createElement("div");
    empty.className = "line-compare-empty";
    empty.innerHTML = "<strong>等待加载文件</strong><span>加载 PDF 或图片后，这里会按 block 显示原文、BDRC 与 AI Vision 结果。</span>";
    els.ocrLineCompare.appendChild(empty);
    renderAiOcrPanelForPage();
    return;
  }

  const { result, compare } = ensureProofreadCompareResult();
  renderAiOcrPanelForPage(compare);

  const bdrcLines = getEffectiveOcrSideLines(compare.bdrc);
  const aiLines = getEffectiveOcrSideLines(compare.llm, bdrcLines);
  const finalLines = result.lines?.length ? result.lines : makeOcrLinesFromText(result.text || "", bdrcLines);
  const rowCount = Math.max(bdrcLines.length, aiLines.length, finalLines.length);

  if (!rowCount) {
    const empty = document.createElement("div");
    empty.className = "line-compare-empty";
    empty.innerHTML = "<strong>等待识别</strong><span>点击“识别”后，每个原文 block 下方会出现 BDRC 与 AI Vision 两个可编辑版本。</span>";
    els.ocrLineCompare.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  Array.from({ length: rowCount }, (_, index) => {
    const bdrcLine = bdrcLines[index] || { text: "", bbox: aiLines[index]?.bbox || finalLines[index]?.bbox || null, index };
    const rawAiLine = aiLines[index] || { text: "", bbox: bdrcLine.bbox || finalLines[index]?.bbox || null, index };
    const aiLine = makeProofreadAiLine(compare, rawAiLine, index, rawAiLine.bbox || bdrcLine.bbox || finalLines[index]?.bbox || null);
    const sourceLine = getSourceLineForRow(bdrcLine, aiLine) || getSourceLineForRow(finalLines[index], null);
    fragment.appendChild(renderProofreadBlockCard({
      index,
      bdrcLine,
      aiLine,
      finalLine: finalLines[index] || null,
      sourceLine,
    }));
  });
  els.ocrLineCompare.appendChild(fragment);
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderProofreadBlockCard({ index, bdrcLine, aiLine, finalLine, sourceLine }) {
  const card = document.createElement("section");
  card.className = "proofread-block-card";
  card.dataset.proofreadBlock = String(index);
  card.dataset.sourceRowIndex = String(index);
  card.classList.toggle("has-source-line", Boolean(sourceLine?.bbox));
  card.title = sourceLine?.bbox ? `点击同步左栏第 ${index + 1} 个原文 block` : "";
  card.classList.toggle("is-active", state.activeOcrLine === index);

  const savedSide = getProofreadDefaultChoice(finalLine, bdrcLine, aiLine);

  const saveButton = document.createElement("button");
  saveButton.className = "secondary-button proofread-save-button";
  saveButton.type = "button";
  saveButton.innerHTML = '<i data-lucide="save"></i>保存修改';
  saveButton.addEventListener("click", () => {
    const selected = card.querySelector("input[type='radio']:checked")?.value || getProofreadDefaultChoice(finalLine, bdrcLine, aiLine);
    saveProofreadBlockChoice(index, selected, card);
  });

  const options = document.createElement("div");
  options.className = "proofread-options proofread-block-actions";
  options.append(
    renderProofreadChoice(index, "bdrc", "采用 BDRC", savedSide === "bdrc"),
    renderProofreadChoice(index, "llm", "采用 AI Vision", savedSide === "llm"),
    saveButton,
  );

  const stack = document.createElement("div");
  stack.className = "proofread-editor-stack";
  stack.append(
    renderProofreadEditorGroup({
      index,
      side: "bdrc",
      label: "BDRC 识别",
      line: bdrcLine,
      peerLine: aiLine,
    }),
    renderProofreadEditorGroup({
      index,
      side: "llm",
      label: "AI Vision 识别",
      line: aiLine,
      peerLine: bdrcLine,
    }),
  );

  const activate = () => {
    const line = sourceLine || bdrcLine || aiLine;
    if (line?.bbox) {
      activateOcrSourceBlock(line, index, { scrollRows: false });
    } else {
      state.activeOcrLine = index;
      markOcrSourceRowsActive(index);
      setActiveSourceBlock(index);
    }
  };
  card.addEventListener("click", (event) => {
    if (event.target.closest("button, textarea, input, label")) return;
    activate();
  });

  const sourcePanel = renderProofreadSourcePanel(sourceLine, index);
  card.append(sourcePanel, stack, options);
  return card;
}

function makeProofreadAiLine(compare, rawAiLine, index, fallbackBbox = null) {
  const line = {
    text: String(rawAiLine?.text || ""),
    bbox: normalizeBbox(rawAiLine?.bbox) || normalizeBbox(fallbackBbox),
    index,
    error: Boolean(rawAiLine?.error),
    missing: Boolean(rawAiLine?.missing),
    diagnostic: Boolean(rawAiLine?.diagnostic),
  };
  if (shouldShowAiVisionDiagnostic(compare, line, index)) {
    return makeMissingAiVisionLine(compare, index, line.bbox || fallbackBbox);
  }
  return line;
}

function renderProofreadChoice(index, value, label, checked) {
  const choice = document.createElement("label");
  choice.className = "proofread-choice";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = `proofread-choice-${state.pageNum}-${index}`;
  input.value = value;
  input.checked = checked;
  choice.append(input, document.createTextNode(label));
  return choice;
}

function renderProofreadSourcePanel(sourceLine, index) {
  const panel = document.createElement("div");
  panel.className = "proofread-source-panel";
  panel.dataset.sourceRowIndex = String(index);

  const title = document.createElement("strong");
  title.textContent = `原文 block ${String(index + 1).padStart(2, "0")} 预览`;
  panel.appendChild(title);

  const preview = createSourceBlockPreviewCanvas(sourceLine);
  if (preview) {
    panel.classList.add("has-preview");
    panel.appendChild(preview);
  } else {
    const fallback = document.createElement("span");
    fallback.textContent = "当前 block 没有可用坐标预览，可在左栏查看整页原文。";
    panel.appendChild(fallback);
  }

  if (sourceLine?.bbox) {
    panel.classList.add("is-locatable");
    panel.addEventListener("click", () => activateOcrSourceBlock(sourceLine, index));
  }
  return panel;
}

function createSourceBlockPreviewCanvas(sourceLine) {
  const bbox = normalizeBbox(sourceLine?.bbox);
  const source = getVisibleSourceElement();
  if (!bbox || !source) return null;

  const sourceWidth = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
  const sourceHeight = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const rawX = bbox.x * sourceWidth;
  const rawY = bbox.y * sourceHeight;
  const rawWidth = Math.max(1, bbox.width * sourceWidth);
  const rawHeight = Math.max(1, bbox.height * sourceHeight);
  const padX = 2;
  const padY = 2;
  const sx = clamp(rawX - padX, 0, Math.max(0, sourceWidth - 1));
  const sy = clamp(rawY - padY, 0, Math.max(0, sourceHeight - 1));
  const ex = clamp(rawX + rawWidth + padX, sx + 1, sourceWidth);
  const ey = clamp(rawY + rawHeight + padY, sy + 1, sourceHeight);
  const sw = Math.max(1, ex - sx);
  const sh = Math.max(1, ey - sy);

  const wrapper = document.createElement("div");
  wrapper.className = "proofread-source-preview";
  const canvas = document.createElement("canvas");
  const maxWidth = 1800;
  const maxScale = Math.max(1, Math.min(2.25, maxWidth / sw));
  const scale = Math.min(maxScale, Math.max(1.15, 84 / sh));
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  wrapper.appendChild(canvas);
  return wrapper;
}

function renderProofreadEditorGroup({ index, side, label, line, peerLine }) {
  const group = document.createElement("div");
  group.className = `proofread-editor-group ${side === "llm" ? "is-ai" : "is-bdrc"}`;
  const blockNumber = String(index + 1).padStart(2, "0");
  const sourceLabel = side === "llm" ? "AI Vision" : "BDRC";

  const labelEl = document.createElement("div");
  labelEl.className = "proofread-editor-label";
  const labelTitle = document.createElement("strong");
  labelTitle.textContent = `${sourceLabel} block ${blockNumber} 识别`;
  const labelMeta = document.createElement("span");
  labelMeta.textContent = `${sourceLabel} 识别结果`;
  const statusEl = document.createElement("em");
  statusEl.className = "proofread-editor-status";
  statusEl.hidden = true;
  labelEl.append(labelTitle, labelMeta, statusEl);

  const editor = document.createElement("div");
  editor.className = "proofread-editor proofread-result-editor";
  editor.contentEditable = "true";
  editor.spellcheck = false;
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-multiline", "true");
  editor.setAttribute("aria-label", `第 ${index + 1} 个 block 的 ${label}`);
  editor.dataset.placeholder = `${sourceLabel} block ${blockNumber} 未返回`;
  const editorBody = document.createElement("div");
  editorBody.className = "proofread-editor-body";
  editorBody.appendChild(editor);

  let userEdited = false;
  const getEditorText = () => editor.textContent || "";
  const renderEditorMarkup = () => {
    const text = normalizeOcrTextSpacing(line?.text || "");
    if (line && line.text !== text) {
      line.text = text;
    }
    const diagnostic = isDiagnosticOcrLine(line);
    const visibleText = text || editor.dataset.placeholder;
    group.classList.toggle("has-diagnostic", diagnostic);
    editor.classList.toggle("is-empty", !text.trim() && !diagnostic);
    editor.classList.toggle("is-diagnostic", diagnostic);
    statusEl.hidden = !diagnostic;
    statusEl.textContent = diagnostic ? visibleText : "";
    if (diagnostic) {
      editor.textContent = visibleText;
    } else {
      const peerText = isDiagnosticOcrLine(peerLine) ? "" : peerLine?.text || "";
      renderOcrLineMarkup(editor, text, {
        peerText,
        highlightDiff: Boolean(text.trim() && String(peerText || "").trim()),
      });
    }
    if (!text.trim()) {
      editor.textContent = editor.dataset.placeholder;
    }
  };
  const syncEditorValue = (fromUserInput = false) => {
    if (isDiagnosticOcrLine(line) && !fromUserInput) {
      resizeLineEditor(editor);
      return;
    }
    const value = normalizeOcrTextSpacing(getEditorText());
    if (line) {
      line.text = value || "";
      if (fromUserInput) {
        line.error = false;
        line.missing = false;
        line.diagnostic = false;
      }
    }
    updateProofreadCompareLine(side, index, value, line, peerLine);
    editor.classList.toggle("is-empty", !String(value || "").trim());
    editor.classList.toggle("is-diagnostic", isDiagnosticOcrLine(line));
    resizeLineEditor(editor);
  };
  renderEditorMarkup();

  editor.addEventListener("focus", () => {
    if (editor.classList.contains("is-empty")) {
      editor.textContent = "";
      editor.classList.remove("is-empty");
    }
    const sourceLine = getSourceLineForRow(line, peerLine);
    if (sourceLine?.bbox) {
      activateOcrSourceBlock(sourceLine, index, { scrollRows: false });
    }
  });
  editor.addEventListener("input", () => {
    userEdited = true;
    syncEditorValue(true);
  });
  editor.addEventListener("blur", () => {
    syncEditorValue(userEdited);
    renderEditorMarkup();
    resizeLineEditor(editor);
    userEdited = false;
  });

  group.append(labelEl, editorBody);
  return group;
}

function getProofreadDefaultChoice(finalLine, bdrcLine, aiLine) {
  const finalText = normalizeCompareText(finalLine?.text || "");
  const bdrcText = normalizeCompareText(bdrcLine?.text || "");
  const aiText = isDiagnosticOcrLine(aiLine) ? "" : normalizeCompareText(aiLine?.text || "");
  if (aiText && finalText === aiText) return "llm";
  if (bdrcText && finalText === bdrcText) return "bdrc";
  if (aiText) return "llm";
  return "bdrc";
}

function ensureProofreadCompareResult() {
  const existing = state.ocrResults.get(state.pageNum) || {
    text: "",
    lines: [],
    source: "manual",
    raw: null,
    updatedAt: "",
  };
  const compare = getOcrSourceCompare(existing) || makeEmptyOcrCompare(existing);
  const result = {
    ...existing,
    compare,
    lines: existing.lines?.length ? existing.lines : makeOcrLinesFromText(existing.text || ""),
  };
  state.ocrResults.set(state.pageNum, result);
  return { result, compare };
}

function ensureProofreadLine(lines, index, fallbackLine = null) {
  while (lines.length <= index) {
    lines.push({ text: "", bbox: null, index: lines.length });
  }
  const line = lines[index] || { text: "", bbox: null, index };
  line.index = index;
  if (!normalizeBbox(line.bbox) && normalizeBbox(fallbackLine?.bbox)) {
    line.bbox = normalizeBbox(fallbackLine.bbox);
  }
  lines[index] = line;
  return line;
}

function updateProofreadCompareLine(side, index, value, line, peerLine) {
  const { result, compare } = ensureProofreadCompareResult();
  const sideKey = side === "bdrc" ? "bdrc" : "llm";
  const normalizedValue = normalizeOcrTextSpacing(value || "");
  const targetLine = ensureProofreadLine(compare[sideKey].lines, index, getSourceLineForRow(line, peerLine));
  targetLine.text = normalizedValue;
  compare[sideKey].text = compare[sideKey].lines.map((item) => item.text || "").join("\n").trim();
  if (sideKey === "llm") {
    compare.llm.returnedLineCount = countNonEmptyOcrLines(compare.llm.lines);
  }
  result.compare = compare;
  result.updatedAt = new Date().toISOString();
  state.ocrResults.set(state.pageNum, result);
  saveCachedResults();
  updateAiOcrPanelMeta(compare);
}

function saveProofreadBlockChoice(index, side, card) {
  const { result, compare } = ensureProofreadCompareResult();
  const sideKey = side === "bdrc" ? "bdrc" : "llm";
  const peerKey = sideKey === "bdrc" ? "llm" : "bdrc";
  const selectedLine = ensureProofreadLine(compare[sideKey].lines, index, compare[peerKey].lines[index]);
  if (sideKey === "llm" && isDiagnosticOcrLine(selectedLine)) {
    setStatus("AI Vision 当前没有可保存的识别文本；请重新识别，或先手动编辑该 AI Vision block。", "warn");
    return;
  }
  const peerLine = compare[peerKey].lines[index] || null;
  const sourceLine = getSourceLineForRow(selectedLine, peerLine) || result.lines?.[index] || null;
  const finalLines = result.lines?.length ? result.lines.map((line, lineIndex) => ({
    text: normalizeOcrTextSpacing(line.text || ""),
    bbox: normalizeBbox(line.bbox),
    index: lineIndex,
  })) : [];
  ensureProofreadLine(finalLines, index, sourceLine);
  finalLines[index] = {
    text: normalizeOcrTextSpacing(selectedLine.text || ""),
    bbox: normalizeBbox(sourceLine?.bbox) || normalizeBbox(finalLines[index]?.bbox),
    index,
  };

  result.lines = finalLines;
  result.text = finalLines.map((line) => line.text || "").join("\n").trim();
  result.compare = compare;
  result.source = "proofread";
  result.updatedAt = new Date().toISOString();
  state.ocrResults.set(state.pageNum, result);
  els.ocrText.value = result.text;
  saveCachedResults();
  updateSummary();
  updateThumbnailState();
  if (card) {
    card.classList.add("is-saved");
    card.querySelectorAll(".proofread-choice input").forEach((input) => {
      input.checked = input.value === sideKey;
    });
    const saveButton = card.querySelector(".proofread-save-button");
    if (saveButton) {
      saveButton.classList.add("is-saved");
      window.setTimeout(() => saveButton.classList.remove("is-saved"), 1600);
    }
  }
  setStatus(`第 ${index + 1} 个 block 已保存为 ${sideKey === "llm" ? "AI Vision" : "BDRC"} 版本。`, "ok");
}

function getCurrentOcrCompareOrEmpty() {
  if (!state.pageCount) {
    return {
      note: "请先加载 PDF 或图片；选择“智能（BDRC + LLM）”识别后，BDRC 与 AI Vision 会分别显示在两个独立栏。",
      bdrc: normalizeOcrCompareSide({ label: "BDRC", text: "", lines: [] }),
      llm: normalizeOcrCompareSide({ label: "AI Vision / LLM", text: "", lines: [] }),
    };
  }

  const result = state.ocrResults.get(state.pageNum);
  return getOcrSourceCompare(result) || makeEmptyOcrCompare(result);
}

function renderOcrSourceSide(container, sideData, peerData, side) {
  container.innerHTML = "";
  const lines = getEffectiveOcrSideLines(sideData);
  const peerLines = getEffectiveOcrSideLines(peerData, lines);
  const hasText = Boolean(String(sideData.text || "").trim() || lines.some((line) => String(line.text || "").trim()));

  if (!hasText && !lines.some((line) => line.error)) {
    const empty = document.createElement("div");
    empty.className = "line-compare-empty";
    const message = side === "bdrc"
      ? "BDRC OCR 结果会显示在这里。"
      : "AI Vision OCR 结果会显示在这里。";
    empty.innerHTML = `<strong>等待结果</strong><span>${message}</span>`;
    container.appendChild(empty);
    return;
  }

  container.appendChild(renderOcrSourceRows({
    lines,
    peerLines,
    rowCount: Math.max(lines.length, peerLines.length, 1),
    side,
  }));
}

function getOcrSourceCompare(result) {
  if (!result) return null;
  const storedCompare = normalizeOcrCompare(result.compare);
  const rawCompare = makeOcrCompareFromRawResult(result);
  if (storedCompare) {
    if (rawCompare) {
      if (!hasOcrSideContent(storedCompare.bdrc) && hasOcrSideContent(rawCompare.bdrc)) {
        storedCompare.bdrc = rawCompare.bdrc;
      }
      if (!hasOcrSideContent(storedCompare.llm) && hasOcrSideContent(rawCompare.llm)) {
        storedCompare.llm = rawCompare.llm;
      }
      storedCompare.note = storedCompare.note || rawCompare.note || "";
    }
    return storedCompare;
  }
  return rawCompare;
}

function makeOcrCompareFromRawResult(result) {
  if (result.source !== "bdrc-ai" || !result.raw || typeof result.raw !== "object") return null;

  const bdrcRaw = result.raw.bdrc;
  const aiRaw = result.raw.ai;
  const bdrcText = extractTextFromJson(bdrcRaw).trim();
  const llmText = extractTextFromJson(aiRaw).trim();
  const bdrcLines = extractOcrLines(bdrcRaw);
  const llmLines = extractOcrLines(aiRaw);
  return normalizeOcrCompare({
    note: result.raw.ai_error
      ? `AI Vision 调用未返回可用文本：${result.raw.ai_error}`
      : "左栏为 BDRC OCR 初稿，右栏为 AI Vision / LLM 识别或复核结果。",
    bdrc: {
      label: "BDRC",
      text: bdrcText,
      lines: bdrcLines.length ? bdrcLines : makeOcrLinesFromText(bdrcText),
    },
    llm: {
      label: "LLM",
      text: llmText,
      lines: llmLines.length ? llmLines : makeOcrLinesFromText(llmText),
      model: getOcrResponseModel(aiRaw),
      provider: getOcrResponseProvider(aiRaw),
      returnedLineCount: llmLines.length || countTextLines(llmText),
      expectedLineCount: bdrcLines.length || countTextLines(bdrcText),
    },
  });
}

function hasOcrSideContent(side) {
  return Boolean(
    String(side?.text || "").trim() ||
    (side?.lines || []).some((line) => String(line?.text || "").trim())
  );
}

function isDiagnosticOcrLine(line) {
  return Boolean(line?.diagnostic || line?.missing || line?.error);
}

function hasUsableAiVisionContent(compare) {
  const side = compare?.llm;
  if (!side || side.error) return false;
  return hasOcrSideContent(side);
}

function shouldShowAiVisionDiagnostic(compare, line, index) {
  if (line?.diagnostic || line?.missing) return true;
  if (line?.error && !hasUsableAiVisionContent(compare)) return true;
  if (String(line?.text || "").trim()) return false;
  if (!hasUsableAiVisionContent(compare)) return true;
  const returned = Number(compare?.llm?.returnedLineCount || 0) || countNonEmptyOcrLines(compare?.llm?.lines || []);
  return Boolean(returned && index >= returned);
}

function makeMissingAiVisionLine(compare, index, fallbackBbox = null) {
  return {
    text: getAiVisionDiagnosticText(compare, index),
    bbox: normalizeBbox(fallbackBbox),
    index,
    error: Boolean(compare?.llm?.error),
    missing: true,
    diagnostic: true,
  };
}

function getAiVisionDiagnosticText(compare, index) {
  const side = compare?.llm;
  const explicitLine = (side?.lines || [])
    .map((line) => String(line?.text || "").trim())
    .find(Boolean);
  const explicitText = String(side?.text || explicitLine || "").trim();
  if (side?.error) {
    return explicitText || "AI Vision 调用失败；请检查 AI OCR 服务后重新识别当前页。";
  }
  if (hasOcrSideContent(side)) {
    return `AI Vision 未返回 block ${String(index + 1).padStart(2, "0")} 的识别结果；模型可能只返回了前几行，请重新识别当前页。`;
  }
  return "AI Vision 未返回文本；请重新识别当前页，或检查 18092 AI OCR 服务。";
}

function renderOcrSourceComparison(compare) {
  const wrapper = document.createElement("section");
  wrapper.className = "ocr-source-compare";

  const note = document.createElement("div");
  note.className = "ocr-source-compare-note";
  note.textContent = compare.note || "左栏为 BDRC OCR 初稿，右栏为 AI Vision / LLM 识别或复核结果。";
  wrapper.appendChild(note);

  const bdrcLines = getEffectiveOcrSideLines(compare.bdrc);
  const llmLines = getEffectiveOcrSideLines(compare.llm, bdrcLines);
  const rowCount = Math.max(bdrcLines.length, llmLines.length);
  const columns = document.createElement("div");
  columns.className = "ocr-source-columns";
  columns.appendChild(
    renderOcrSourceColumn({
      title: "BDRC OCR",
      subtitle: "本地识别初稿",
      lines: bdrcLines,
      peerLines: llmLines,
      rowCount,
      side: "bdrc",
    })
  );
  columns.appendChild(
    renderOcrSourceColumn({
      title: "AI Vision / LLM",
      subtitle: "智能识别或复核",
      lines: llmLines,
      peerLines: bdrcLines,
      rowCount,
      side: "llm",
    })
  );
  wrapper.appendChild(columns);

  return wrapper;
}

function renderOcrSourceRows({ lines, peerLines, rowCount, side }) {
  const body = document.createElement("div");
  body.className = `ocr-source-column-body ocr-source-single-body ${side === "bdrc" ? "is-bdrc" : "is-llm"}`;
  const count = Math.max(1, rowCount);
  for (let index = 0; index < count; index += 1) {
    const line = lines[index] || { text: "" };
    const peerLine = peerLines[index] || { text: "" };
    const comparePeerText = isDiagnosticOcrLine(peerLine) ? "" : peerLine.text || "";
    const row = document.createElement("div");
    row.className = "ocr-source-column-row";
    row.dataset.sourceRowIndex = String(index);
    row.dataset.sourceSide = side;
    row.classList.toggle("has-difference", Boolean(comparePeerText) && normalizeCompareText(line.text) !== normalizeCompareText(comparePeerText));
    row.classList.toggle("is-empty", !String(line.text || "").trim());
    row.classList.toggle("is-error", Boolean(line.error));

    const number = document.createElement("div");
    number.className = "ocr-source-compare-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const text = document.createElement("div");
    text.className = "ocr-source-compare-cell";
    text.classList.toggle("is-empty", !String(line.text || "").trim());
    text.classList.toggle("is-error", Boolean(line.error));
    if (line.error) {
      text.textContent = line.text || "";
    } else {
      renderOcrLineMarkup(text, line.text || "", {
        peerText: comparePeerText,
        highlightDiff: Boolean(String(line.text || "").trim() && String(comparePeerText || "").trim()),
      });
    }

    row.append(number, text);
    const sourceLine = getSourceLineForRow(line, peerLine);
    if (sourceLine?.bbox) {
      row.classList.add("is-locatable");
      row.addEventListener("click", () => activateOcrSourceBlock(sourceLine, index));
    }
    body.appendChild(row);
  }
  return body;
}

function renderOcrSourceColumn({ title, subtitle, lines, peerLines, rowCount, side }) {
  const column = document.createElement("article");
  column.className = `ocr-source-column ${side === "bdrc" ? "is-bdrc" : "is-llm"}`;

  const header = document.createElement("div");
  header.className = "ocr-source-column-header";
  header.innerHTML = `<strong>${title}</strong><span>${subtitle}</span>`;
  column.appendChild(header);

  column.appendChild(renderOcrSourceRows({ lines, peerLines, rowCount, side }));
  return column;
}

function makeEmptyOcrCompare(result) {
  let note = "选择“智能（BDRC + LLM）”后点击“识别”，BDRC 与 AI Vision 会分别显示在两个独立栏。";
  let bdrcText = "";
  let llmText = "";
  if (result?.source === "bdrc") {
    bdrcText = result.text || "";
    note = "当前只有 BDRC 结果；请用“智能（BDRC + LLM）”重新识别，生成右栏 AI Vision / LLM。";
  } else if (result?.source === "ai-vision") {
    llmText = result.text || "";
    note = "当前只有 AI Vision 结果；请用“智能（BDRC + LLM）”重新识别，生成左栏 BDRC。";
  } else if (result?.text) {
    note = "当前是旧缓存或直接文本结果；请用“智能（BDRC + LLM）”重新识别当前页。";
  }
  return {
    note,
    bdrc: normalizeOcrCompareSide({ label: "BDRC", text: bdrcText, lines: makeOcrLinesFromText(bdrcText) }),
    llm: normalizeOcrCompareSide({
      label: "AI Vision / LLM",
      text: llmText,
      lines: makeOcrLinesFromText(llmText),
      model: getOcrResponseModel(result?.raw),
      provider: getOcrResponseProvider(result?.raw),
      returnedLineCount: countTextLines(llmText),
    }),
  };
}

function getEffectiveOcrSideLines(sideData, fallbackLines = []) {
  const storedLines = Array.isArray(sideData?.lines) ? sideData.lines : [];
  const textLines = makeOcrLinesFromText(sideData?.text || "", fallbackLines);
  if (!storedLines.length) return textLines;

  const hasStoredText = storedLines.some((line) => String(line?.text || "").trim());
  if (!hasStoredText && textLines.length) return textLines;

  return storedLines.map((line, index) => ({
    text: normalizeOcrTextSpacing(line?.text || textLines[index]?.text || ""),
    bbox: normalizeBbox(line?.bbox) || normalizeBbox(textLines[index]?.bbox) || normalizeBbox(fallbackLines[index]?.bbox),
    index,
    error: Boolean(line?.error),
    missing: Boolean(line?.missing),
    diagnostic: Boolean(line?.diagnostic),
  }));
}

function normalizeCompareText(text) {
  return String(text || "").replace(/\s+/g, "");
}

function normalizeOcrTextSpacing(text) {
  return String(text || "")
    .replace(/([\u3400-\u9fff])[\t \u00a0]+(?=[\u3400-\u9fff])/g, "$1")
    .replace(/([\u3400-\u9fff])[\t \u00a0]+(?=[，。！？；：、））》」』”’])/g, "$1")
    .replace(/([，。！？；：、（《「『“‘])[\t \u00a0]+(?=[\u3400-\u9fff])/g, "$1")
    .replace(/([））》」』”’])[\t \u00a0]+(?=[\u3400-\u9fff])/g, "$1");
}

function renderOcrLineMarkup(container, text, options = {}) {
  container.textContent = "";
  if (!text) return;

  const highRiskRanges = getHighRiskClusterScan(text)
    .filter((cluster) => cluster.highRisk)
    .map(({ start, end }) => ({ start, end }));
  const diffRanges = options.highlightDiff ? getOcrDiffRanges(text, options.peerText || "") : [];
  const boundaries = Array.from(new Set([
    0,
    text.length,
    ...highRiskRanges.flatMap((range) => [range.start, range.end]),
    ...diffRanges.flatMap((range) => [range.start, range.end]),
  ])).sort((a, b) => a - b);

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (end <= start) continue;
    const segment = text.slice(start, end);
    if (!segment) continue;

    const highRisk = highRiskRanges.some((range) => rangesOverlap(start, end, range.start, range.end));
    const different = diffRanges.some((range) => rangesOverlap(start, end, range.start, range.end));
    if (!highRisk && !different) {
      container.appendChild(document.createTextNode(segment));
      continue;
    }

    const mark = document.createElement("span");
    mark.className = [
      highRisk ? "ocr-risk-inline" : "",
      different ? "ocr-diff-inline" : "",
    ].filter(Boolean).join(" ");
    mark.title = [
      highRisk ? "高危：包含藏文上下加字或组合符，优先人工校对" : "",
      different ? "差异：BDRC 与 AI Vision 此处不一致" : "",
    ].filter(Boolean).join("；");
    mark.textContent = segment;
    container.appendChild(mark);
  }
}

function getOcrDiffRanges(text, peerText) {
  const sourceTokens = tokenizeOcrDiffText(text);
  const peerTokens = tokenizeOcrDiffText(peerText);
  if (!sourceTokens.length || !peerTokens.length) return [];

  const rows = sourceTokens.length + 1;
  const cols = peerTokens.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let row = sourceTokens.length - 1; row >= 0; row -= 1) {
    for (let col = peerTokens.length - 1; col >= 0; col -= 1) {
      dp[row][col] = sourceTokens[row].value === peerTokens[col].value
        ? dp[row + 1][col + 1] + 1
        : Math.max(dp[row + 1][col], dp[row][col + 1]);
    }
  }

  const matched = new Set();
  let row = 0;
  let col = 0;
  while (row < sourceTokens.length && col < peerTokens.length) {
    if (sourceTokens[row].value === peerTokens[col].value) {
      matched.add(row);
      row += 1;
      col += 1;
    } else if (dp[row + 1][col] >= dp[row][col + 1]) {
      row += 1;
    } else {
      col += 1;
    }
  }

  return mergeRanges(sourceTokens
    .map((token, index) => ({ ...token, index }))
    .filter((token) => !matched.has(token.index))
    .map(({ start, end }) => ({ start, end })));
}

function tokenizeOcrDiffText(text) {
  const source = String(text || "");
  const clusters = getHighRiskClusterScan(source);
  const tokens = [];
  let cursor = 0;

  const pushLooseText = (looseText, offset) => {
    let localOffset = 0;
    for (const char of Array.from(looseText)) {
      const start = offset + localOffset;
      const end = start + char.length;
      localOffset += char.length;
      if (/\s/.test(char)) continue;
      tokens.push({ value: char, start, end });
    }
  };

  clusters.forEach((cluster) => {
    if (cluster.start > cursor) {
      pushLooseText(source.slice(cursor, cluster.start), cursor);
    }
    tokens.push({ value: cluster.text, start: cluster.start, end: cluster.end });
    cursor = cluster.end;
  });

  if (cursor < source.length) {
    pushLooseText(source.slice(cursor), cursor);
  }

  return tokens;
}

function mergeRanges(ranges) {
  const sorted = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  sorted.forEach((range) => {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  });
  return merged;
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function getHighRiskClusterScan(text) {
  return Array.from(text.matchAll(TIBETAN_CLUSTER_RE)).map((match) => {
    const cluster = match[0];
    const start = match.index || 0;
    return {
      text: cluster,
      start,
      end: start + cluster.length,
      highRisk: TIBETAN_HIGH_RISK_MARK_RE.test(cluster),
    };
  });
}

function getHighRiskClusters(text) {
  return getHighRiskClusterScan(text).filter((cluster) => cluster.highRisk);
}

function getSourceLineForRow(line, peerLine = null) {
  if (normalizeBbox(line?.bbox)) return line;
  if (normalizeBbox(peerLine?.bbox)) return peerLine;
  return null;
}

function getVisibleSourceElement() {
  const source = state.sourceType === "image" ? els.imagePage : els.pdfCanvas;
  if (!source || source.style.display === "none") return null;
  return source;
}

function clearSourceBlockOverlay() {
  if (els.sourceBlockOverlay) {
    els.sourceBlockOverlay.innerHTML = "";
  }
}

function renderSourceBlockOverlay() {
  if (!els.sourceBlockOverlay) return;
  els.sourceBlockOverlay.innerHTML = "";

  const source = getVisibleSourceElement();
  if (!source || !state.pageCount) return;

  const blocks = getCurrentSourceBlockRecords();
  if (!blocks.length) return;

  const fragment = document.createDocumentFragment();
  blocks.forEach((block) => {
    const box = getSourceOverlayBox(block.bbox, source);
    if (!box) return;

    const item = document.createElement("div");
    item.className = [
      "source-sync-block",
      block.hasBdrc ? "has-bdrc" : "",
      block.hasAi ? "has-ai" : "",
      block.hasDifference ? "has-difference" : "",
      state.activeOcrLine === block.index ? "is-active" : "",
    ].filter(Boolean).join(" ");
    item.dataset.sourceRowIndex = String(block.index);
    item.title = `第 ${block.index + 1} 行原文同步框`;
    Object.assign(item.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    fragment.appendChild(item);
  });
  els.sourceBlockOverlay.appendChild(fragment);
}

function getCurrentSourceBlockRecords() {
  const result = state.ocrResults.get(state.pageNum);
  if (!result) return [];

  const compare = getOcrSourceCompare(result);
  if (compare) {
    const bdrcLines = getEffectiveOcrSideLines(compare.bdrc);
    const aiLines = getEffectiveOcrSideLines(compare.llm, bdrcLines);
    const count = Math.max(bdrcLines.length, aiLines.length);
    return Array.from({ length: count }, (_, index) => {
      const bdrcLine = bdrcLines[index] || { text: "" };
      const aiLine = aiLines[index] || { text: "" };
      return makeSourceBlockRecord({
        index,
        line: getSourceLineForRow(bdrcLine, aiLine),
        hasBdrc: Boolean(String(bdrcLine.text || "").trim()),
        hasAi: Boolean(String(aiLine.text || "").trim()),
        hasDifference: normalizeCompareText(bdrcLine.text) !== normalizeCompareText(aiLine.text),
      });
    }).filter(Boolean);
  }

  const lines = result.lines?.length ? result.lines : extractOcrLines(result.raw);
  return (lines || [])
    .map((line, index) => makeSourceBlockRecord({
      index,
      line,
      hasBdrc: Boolean(String(line?.text || "").trim()),
      hasAi: false,
      hasDifference: false,
    }))
    .filter(Boolean);
}

function makeSourceBlockRecord({ index, line, hasBdrc, hasAi, hasDifference }) {
  const bbox = normalizeBbox(line?.bbox);
  if (!bbox) return null;
  return {
    index,
    bbox,
    hasBdrc,
    hasAi,
    hasDifference,
  };
}

function getSourceOverlayBox(bbox, source) {
  const normalized = normalizeBbox(bbox);
  if (!normalized || !source || !els.pageViewport) return null;

  const sourceWidth = source.clientWidth;
  const sourceHeight = source.clientHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const viewportRect = els.pageViewport.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  const sourceLeft = sourceRect.left - viewportRect.left + els.pageViewport.scrollLeft;
  const sourceTop = sourceRect.top - viewportRect.top + els.pageViewport.scrollTop;
  const rawLeft = sourceLeft + normalized.x * sourceWidth;
  const rawTop = sourceTop + normalized.y * sourceHeight;
  const rawWidth = normalized.width * sourceWidth;
  const rawHeight = normalized.height * sourceHeight;
  const horizontalPadding = Math.max(2, Math.min(8, rawHeight * 0.16));
  const verticalPadding = Math.max(3, Math.min(12, rawHeight * 0.32));
  const left = Math.max(sourceLeft, rawLeft - horizontalPadding);
  const top = Math.max(sourceTop, rawTop - verticalPadding);
  return {
    left,
    top,
    width: Math.max(6, Math.min(sourceLeft + sourceWidth - left, rawWidth + horizontalPadding * 2)),
    height: Math.max(6, Math.min(sourceTop + sourceHeight - top, rawHeight + verticalPadding * 2)),
  };
}

function handleSourceViewportClick(event) {
  const source = getVisibleSourceElement();
  if (!source || event.target === els.emptyState || els.emptyState?.contains(event.target)) return;

  const sourceRect = source.getBoundingClientRect();
  if (
    event.clientX < sourceRect.left ||
    event.clientX > sourceRect.right ||
    event.clientY < sourceRect.top ||
    event.clientY > sourceRect.bottom
  ) {
    return;
  }

  renderSourceBlockOverlay();
  const hit = findSourceBlockAtPoint(event.clientX, event.clientY);
  if (!hit) return;

  event.preventDefault();
  activateOcrSourceBlock({ bbox: hit.block.bbox }, hit.block.index, {
    scrollSource: false,
    scrollRows: true,
  });
}

function findSourceBlockAtPoint(clientX, clientY) {
  const source = getVisibleSourceElement();
  if (!source || !els.pageViewport) return null;

  const viewportRect = els.pageViewport.getBoundingClientRect();
  const point = {
    x: clientX - viewportRect.left + els.pageViewport.scrollLeft,
    y: clientY - viewportRect.top + els.pageViewport.scrollTop,
  };
  const tolerance = 8;
  const hits = getCurrentSourceBlockRecords()
    .map((block) => ({ block, box: getSourceOverlayBox(block.bbox, source) }))
    .filter(({ box }) => box && (
      point.x >= box.left - tolerance &&
      point.x <= box.left + box.width + tolerance &&
      point.y >= box.top - tolerance &&
      point.y <= box.top + box.height + tolerance
    ))
    .sort((a, b) => {
      const areaA = a.box.width * a.box.height;
      const areaB = b.box.width * b.box.height;
      if (areaA !== areaB) return areaA - areaB;
      const centerA = Math.abs(point.y - (a.box.top + a.box.height / 2));
      const centerB = Math.abs(point.y - (b.box.top + b.box.height / 2));
      return centerA - centerB;
    });

  if (hits.length) return hits[0];
  return null;
}

function activateOcrSourceBlock(line, index, options = {}) {
  state.activeOcrLine = index;
  markOcrSourceRowsActive(index);
  setActiveSourceBlock(index);
  if (options.scrollRows) {
    scrollOcrRowsIntoView(index);
  }
  showSourceLineHighlight(line, { scrollIntoView: options.scrollSource !== false });
}

function markOcrSourceRowsActive(index) {
  document.querySelectorAll(".ocr-source-column-row.is-active, .ocr-line-row.is-active, .proofread-block-card.is-active").forEach((item) => {
    item.classList.remove("is-active");
  });
  document.querySelectorAll(`.ocr-source-column-row[data-source-row-index="${index}"]`).forEach((item) => {
    item.classList.add("is-active");
  });
  document.querySelectorAll(`.ocr-line-row[data-source-row-index="${index}"]`).forEach((item) => {
    item.classList.add("is-active");
  });
  document.querySelectorAll(`.proofread-block-card[data-source-row-index="${index}"]`).forEach((item) => {
    item.classList.add("is-active");
  });
}

function setActiveSourceBlock(index) {
  if (!els.sourceBlockOverlay) return;
  els.sourceBlockOverlay.querySelectorAll(".source-sync-block.is-active").forEach((item) => {
    item.classList.remove("is-active");
  });
  const block = els.sourceBlockOverlay.querySelector(`.source-sync-block[data-source-row-index="${index}"]`);
  if (block) {
    block.classList.add("is-active");
  }
}

function scrollOcrRowsIntoView(index) {
  const rows = document.querySelectorAll(
    `.ocr-source-column-row[data-source-row-index="${index}"], .ocr-line-row[data-source-row-index="${index}"], .proofread-block-card[data-source-row-index="${index}"]`,
  );
  rows.forEach((row) => {
    row.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  });
}

function activateOcrLine(line, index, row) {
  state.activeOcrLine = index;
  els.ocrLineCompare.querySelectorAll(".ocr-line-row.is-active").forEach((item) => {
    item.classList.remove("is-active");
  });
  document.querySelectorAll(".ocr-source-column-row.is-active").forEach((item) => {
    item.classList.remove("is-active");
  });
  row.classList.add("is-active");
  setActiveSourceBlock(index);
  showSourceLineHighlight(line);
}

function showSourceLineHighlight(line, options = {}) {
  const bbox = line?.bbox || line;
  const normalized = normalizeBbox(bbox);
  const source = state.sourceType === "image" ? els.imagePage : els.pdfCanvas;
  if (!normalized || !source || source.style.display === "none") {
    els.sourceLineHighlight.classList.remove("is-visible");
    return;
  }

  const sourceWidth = source.clientWidth;
  const sourceHeight = source.clientHeight;
  const viewportRect = els.pageViewport.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  const sourceLeft = sourceRect.left - viewportRect.left + els.pageViewport.scrollLeft;
  const sourceTop = sourceRect.top - viewportRect.top + els.pageViewport.scrollTop;
  const left = sourceLeft + normalized.x * sourceWidth;
  const width = normalized.width * sourceWidth;
  const rawTop = sourceTop + normalized.y * sourceHeight;
  const rawHeight = normalized.height * sourceHeight;
  const verticalPadding = Math.max(8, rawHeight * 0.45);
  const top = Math.max(sourceTop, rawTop - verticalPadding);
  const height = Math.min(sourceTop + sourceHeight - top, rawHeight + verticalPadding * 2);
  Object.assign(els.sourceLineHighlight.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
  els.sourceLineHighlight.classList.add("is-visible");

  if (options.scrollIntoView !== false) {
    els.pageViewport.scrollTo({
      left: Math.max(0, left + width / 2 - els.pageViewport.clientWidth / 2),
      top: Math.max(0, top + height / 2 - els.pageViewport.clientHeight / 2),
      behavior: "smooth",
    });
  }
}

function renderActiveSourceHighlight() {
  if (state.activeOcrLine < 0) {
    els.sourceLineHighlight.classList.remove("is-visible");
    setActiveSourceBlock(-1);
    return;
  }
  const result = state.ocrResults.get(state.pageNum);
  const line = result?.lines?.[state.activeOcrLine];
  setActiveSourceBlock(state.activeOcrLine);
  showSourceLineHighlight(line);
}

function clearSourceLineHighlight() {
  state.activeOcrLine = -1;
  els.sourceLineHighlight.classList.remove("is-visible");
  document.querySelectorAll(".ocr-source-column-row.is-active, .ocr-line-row.is-active, .proofread-block-card.is-active").forEach((item) => {
    item.classList.remove("is-active");
  });
  setActiveSourceBlock(-1);
}

function resizeLineEditor(editor) {
  if (editor.classList.contains("proofread-editor")) {
    editor.style.height = "";
    return;
  }
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

function downloadAllAiOcrText() {
  const pages = [...state.ocrResults.entries()]
    .map(([pageNum, result]) => {
      const compare = getOcrSourceCompare(result);
      const text = compare?.llm?.text || (result?.source === "ai-vision" ? result.text : "");
      return [pageNum, text];
    })
    .filter(([, text]) => String(text || "").trim())
    .sort((a, b) => a[0] - b[0]);

  if (!pages.length) {
    setStatus("还没有可导出的 AI Vision OCR 文本。", "warn");
    return;
  }

  const body = [
    `# ${state.sourceName || "AI Vision OCR"} 识别结果`,
    "",
    ...pages.flatMap(([pageNum, text]) => [
      `## 第 ${pageNum} 页`,
      "",
      text || "",
      "",
    ]),
  ].join("\n");
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const safeName = (state.sourceName || "ai-vision-ocr").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_");
  downloadBlob(blob, `${safeName}_ai_ocr.md`);
  setStatus("已导出全部 AI Vision OCR 文本。", "ok");
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
  const sourceLabel = getResultSourceLabel(result);
  if (result?.source === "pdf-text") {
    els.ocrTitle.textContent = `第 ${state.pageNum} 页文本层`;
  } else if (state.sourceType === "word") {
    els.ocrTitle.textContent = "Word 文本";
  } else if (state.sourceType === "markdown" || state.sourceType === "text") {
    els.ocrTitle.textContent = state.sourceType === "text" ? "文本文件" : "Markdown 文本";
  } else {
    els.ocrTitle.textContent = state.sourceType === "image" ? "图片 OCR" : `第 ${state.pageNum} 页 OCR`;
  }
  els.ocrText.value = result?.text || "";
  els.ocrMeta.textContent = result?.text
    ? (isDirectTextSource(result.source) ? sourceLabel : "已识别")
    : "未识别";
  els.ocrMeta.style.color = result?.text
    ? (isDirectTextSource(result.source) ? "var(--blue)" : "var(--green-deep)")
    : "var(--muted)";
  renderCurrentOcrView();
  renderSourceBlockOverlay();
  updateSummary();
}

function updateAiOcrPanelMeta(compare = null) {
  if (!els.aiOcrTitle || !els.aiOcrMeta) return;
  const sourceCompare = compare || getCurrentOcrCompareOrEmpty();
  const aiText = sourceCompare.llm.text || "";
  const aiLines = sourceCompare.llm.lines || [];
  const bdrcLines = sourceCompare.bdrc?.lines || [];
  const hasAiText = Boolean(aiText.trim());
  const hasAiError = Boolean(sourceCompare.llm.error || aiLines.some((line) => line.error));
  const returnedLineCount = sourceCompare.llm.returnedLineCount || countNonEmptyOcrLines(aiLines);
  const expectedLineCount = sourceCompare.llm.expectedLineCount || countNonEmptyOcrLines(bdrcLines);
  const model = sourceCompare.llm.model || "AI Vision";
  const lineMeta = expectedLineCount
    ? `${returnedLineCount}/${expectedLineCount} 行`
    : `${returnedLineCount} 行`;

  els.aiOcrTitle.textContent = state.pageCount ? `第 ${state.pageNum} 页 AI Vision` : "等待智能识别";
  els.aiOcrMeta.textContent = hasAiText ? `${model} · ${lineMeta}` : hasAiError ? "调用失败" : "未返回";
  els.aiOcrMeta.title = hasAiText
    ? `AI Vision 模型：${model}${sourceCompare.llm.provider ? `；服务：${sourceCompare.llm.provider}` : ""}；返回行数：${lineMeta}`
    : "";
  els.aiOcrMeta.style.color = hasAiText
    ? "var(--blue)"
    : hasAiError
      ? "var(--danger)"
      : "var(--muted)";
  els.aiCharCount.textContent = String([...aiText.replace(/\s+/g, "")].length);
  els.aiLineCount.textContent = expectedLineCount ? `${returnedLineCount} / ${expectedLineCount}` : String(returnedLineCount);
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
  updateAiOcrPanelMeta();
}

function updateFileOcrStatus(recognizedCount = null) {
  if (!els.fileOcrStatus) return;
  const recognized = recognizedCount ?? [...state.ocrResults.values()].filter((result) => (result.text || "").trim()).length;
  const directTextCount = [...state.ocrResults.values()].filter((result) => (result.text || "").trim() && isDirectTextSource(result.source)).length;
  let text = "ocr 识别未开始";
  let className = "file-status status-not-started";

  if (state.pageCount && directTextCount >= state.pageCount) {
    text = "文本已提取";
    className = "file-status status-complete";
  } else if (directTextCount > 0) {
    text = "文本提取进行中";
    className = "file-status status-in-progress";
  } else if (state.pageCount && recognized >= state.pageCount) {
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
    const pageResult = state.ocrResults.get(pageNum);
    const recognized = Boolean((pageResult?.text || "").trim());
    const directText = recognized && isDirectTextSource(pageResult?.source);
    const translated = Boolean((state.translationResults.get(pageNum)?.text || "").trim());
    button.classList.toggle("active", pageNum === state.pageNum);
    button.classList.toggle("recognized", recognized);
    button.classList.toggle("direct-text", directText);
    button.classList.toggle("translated", translated);
  });
}

function refreshControls() {
  const hasDocument = state.pageCount > 0;
  syncPageControls(hasDocument);
  els.prevButton.disabled = !hasDocument || state.pageNum <= 1;
  els.nextButton.disabled = !hasDocument || state.pageNum >= state.pageCount;
  els.viewerFirstPageButton.disabled = !hasDocument || state.pageNum <= 1;
  els.viewerPrevPageButton.disabled = !hasDocument || state.pageNum <= 1;
  els.viewerNextPageButton.disabled = !hasDocument || state.pageNum >= state.pageCount;
  els.viewerLastPageButton.disabled = !hasDocument || state.pageNum >= state.pageCount;
  els.ocrButton.disabled = !hasDocument;
  setOptionalDisabled("downloadPageButton", !hasDocument);
  els.copyButton.disabled = !hasDocument;
  setOptionalDisabled("clearButton", !hasDocument);
  els.downloadTextButton.disabled = !hasDocument;
  els.copyAiButton.disabled = !hasDocument;
  els.downloadAiTextButton.disabled = !hasDocument;
  els.translateButton.disabled = !hasDocument;
  els.copyTranslationButton.disabled = !hasDocument;
  els.clearTranslationButton.disabled = !hasDocument;
  els.downloadTranslationButton.disabled = !hasDocument;
}

function syncPageControls(hasDocument = state.pageCount > 0) {
  const current = String(state.pageNum || 1);
  const max = String(state.pageCount || 1);
  [els.pageInput, els.viewerPageInput].forEach((input) => {
    if (!input) return;
    input.disabled = !hasDocument;
    input.max = max;
    input.value = current;
  });
  if (els.pageTotal) {
    els.pageTotal.textContent = `/ ${state.pageCount || 0}`;
  }
  if (els.renderMeta) {
    els.renderMeta.textContent = `/ ${state.pageCount || 0}`;
  }
}

function setBusy(isBusy) {
  state.isOcrBusy = Boolean(isBusy);
  els.ocrButton.disabled = isBusy || !state.pageCount;
  setOptionalDisabled("checkOcrButton", isBusy);
  els.ocrButton.querySelector("span").textContent = isBusy ? "识别中" : "识别";
}

function setTranslateBusy(isBusy) {
  state.isTranslateBusy = Boolean(isBusy);
  els.translateButton.disabled = isBusy || !state.pageCount;
  setOptionalDisabled("checkTranslateButton", isBusy);
  els.translateButton.querySelector("span").textContent = isBusy ? "翻译中" : "翻译";
}

function setOptionalDisabled(id, disabled) {
  if (els[id]) {
    els[id].disabled = disabled;
  }
}

function formatNetworkError(error, url, service = "ocr") {
  const resolvedService = service === "ocr" && String(url || "").includes(":18092")
    ? "ai-ocr"
    : service;
  if (String(error?.message || "").includes("Failed to fetch")) {
    if (resolvedService === "translate") {
      return `无法连接 ${url}。请先启动本地藏译汉服务：python3 tibetan-translation-services/nllb_translate_server.py；或把接口地址改成可用的翻译 API。`;
    }
    if (resolvedService === "ai-ocr") {
      return `无法连接 ${url}。请先启动本地 AI Vision OCR 服务：python3 tibetan-ocr-core/ai_vision_ocr_server.py；或运行 ./tibetan-proofreading-app/start_services.sh`;
    }
    return `无法连接 ${url}。请先启动本地 OCR 服务：python3 tibetan-ocr-core/bdrc_ocr_server.py`;
  }
  return summarizeServiceError(error?.message || String(error));
}

function summarizeServiceError(message) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text) return "未知错误";
  if (text.includes("RESOURCE_EXHAUSTED") || text.includes("Quota exceeded") || text.includes("HTTP 429")) {
    const retryMatch = text.match(/retry in ([0-9.]+)s/i);
    const retry = retryMatch ? `，建议 ${Math.ceil(Number(retryMatch[1]))} 秒后重试` : "";
    return `上游模型额度或频率限制耗尽（HTTP 429 / RESOURCE_EXHAUSTED）${retry}。请更换可用的 AI Vision 模型/API key，或稍后重试。`;
  }
  return text.length > 420 ? `${text.slice(0, 420)}...` : text;
}

function setStatus(message, tone = "") {
  const text = String(message || "").trim();
  const shouldShow = shouldShowStatus(text, tone);
  els.statusBar.textContent = shouldShow ? text : "";
  els.statusBar.hidden = !shouldShow;
  els.statusBar.className = `status-bar ${tone} ${shouldShow ? "" : "is-hidden"}`.trim();
}

function shouldShowStatus(message, tone = "") {
  if (!message) return false;
  if (tone === "error") return true;
  if (tone === "ok") return false;
  if (tone === "warn") {
    if (QUIET_STATUS_RE.test(message) && !/(失败|不可用|无法|损坏|无效)/.test(message)) return false;
    return /请|无法|失败|不可用|未初始化|正在|耗尽|限制|损坏|无效|回落|回退|不能|尚未|缺失/.test(message);
  }
  return false;
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
