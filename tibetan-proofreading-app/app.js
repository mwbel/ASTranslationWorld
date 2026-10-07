const SAMPLE_PDF_URL = "../藏文/天文历算学-本科教材 藏文40301698_部分.pdf";
const PDF_WORKER_URL = "./vendor/pdf.worker.min.js";
const APP_BUILD_ID = "20261007-line-crop-v24";
const REVIEW_MODEL_DEFAULTS = { qwen: ["qwen3.5-ocr", "qwen3.8-max", "qwen3.7-plus"], gemini: ["gemini-2.5-flash", "gemini-3.1-flash-lite"] };
const reviewCatalogRequests = new Map();
const SOURCE_LAYOUT_VERSION = 4;
window.__TIBETAN_PROOFREADING_APP_BUILD_ID__ = APP_BUILD_ID;
const CACHE_PREFIX = "tibetan-proofreading-app:v1:";
const ACTIVE_PROJECT_KEY = "tibetan-proofreading-app:active-project";
const SOURCE_DB_NAME = "tibetan-proofreading-app-sources";
const SOURCE_STORE_NAME = "files";
const FOLDER_PROJECTS_KEY = "tibetan-proofreading-app:folder-projects:v1";
const HOME_PROJECT_FILTERS = new Set(["all", "ocr", "translation"]);
const OCR_FONT_SIZE_KEY = "tibetan-proofreading-app:ocr-font-size";
const SOURCE_PREVIEW_SCALE_KEY = "tibetan-proofreading-app:source-preview-scale";
const SOURCE_PAGE_ZOOM_MIN = 0.75;
const SOURCE_PAGE_ZOOM_MAX = 4;
const SOURCE_PAGE_ZOOM_STEP = 0.25;
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
const CANONICAL_REGION_ORDER = Object.freeze(["left", "center", "right"]);
const CANONICAL_REGION_DEFAULTS = Object.freeze({
  left: {
    label: "左侧",
    role: "side",
    direction: "vertical",
    textOrientation: "vertical-or-page-number",
    regionType: "margin",
  },
  center: {
    label: "中间",
    role: "body",
    direction: "horizontal",
    textOrientation: "horizontal",
    regionType: "body",
  },
  right: {
    label: "右侧",
    role: "side",
    direction: "vertical",
    textOrientation: "vertical-or-page-number",
    regionType: "margin",
  },
});
const OCR_PROFILES = Object.freeze({
  handwritten: {
    label: "手写体",
    model: "Ume_Petsuk",
    lineMode: "line",
    prompt: "这是藏文手写体资料。优先适应手写笔画、连写和不规则字距；无法确认的字符不要凭语义补写。",
  },
  traditional: {
    label: "传统经书印刷版式",
    model: "Woodblock-Stacks",
    lineMode: "line",
    prompt: "这是传统藏文经书/木刻印刷版式。优先保留堆叠字、上加字、下加字、朱色标记和经书行序；不要把边框、页码或边注误并入正文。",
  },
  modern: {
    label: "现代印刷版式",
    model: "Modern",
    lineMode: "line",
    prompt: "这是现代藏文印刷版式。优先识别清晰的标准印刷字形，同时严格保留藏文音节和标点，不要按语义改写。",
  },
});
const DEFAULT_OCR_PROFILE = "traditional";
const SOURCE_PREVIEW_SCALE_MIN = 0.7;
const SOURCE_PREVIEW_SCALE_MAX = 1.75;
const SOURCE_PREVIEW_SCALE_STEP = 0.15;
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
  proofreadViewer: 1.18,
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
  pdfFile: null,
  pdfPageRenderUrl: "",
  pdfPageRenderCache: new Map(),
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
  ocrProfile: DEFAULT_OCR_PROFILE,
  translationResults: new Map(),
  ocrQualityReviews: [],
  ocrView: "lines",
  ocrFontSize: 22,
  sourcePreviewScale: 1,
  sourcePageZoom: 1.25,
  activeOcrLine: -1,
  renderToken: 0,
  thumbnailToken: 0,
  layout: { ...DEFAULT_LAYOUT },
  translationRoles: [...BUILT_IN_TRANSLATION_ROLES],
  activeTranslationRoleId: "academic-literal",
  editingRoleId: "academic-literal",
  activeWorkflow: "home",
  homeProjectFilter: "all",
  pendingHomeProjectDeletionId: "",
  folderProjectFiles: new Map(),
  pendingFolderProjectId: "",
  activeFolderProjectId: "",
  isOcrBusy: false,
  batchOcr: null,
  isTranslateBusy: false,
  remoteBookId: "",
  remoteSaveTimer: null,
  layoutHydrationInFlight: new Map(),
  activeProjectRestoreInFlight: false,
};

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.appBuild = APP_BUILD_ID;
  cacheElements();
  restoreTranslationRoles();
  restoreOcrFontSize();
  restoreSourcePreviewScale();
  restoreWorkspaceLayout();
  configureDeploymentEndpoints();
  wireEvents();
  renderTranslationRoleOptions();
  renderActiveTranslationRoleMeta();
  configurePdfJs();
  refreshControls();
  updateSummary();
  updateTranslationSummary();
  void restoreRouteFromLocation();
  window.addEventListener("popstate", restoreRouteFromLocation);
  warnIfFileProtocol();
  if (window.lucide) {
    window.lucide.createIcons();
  }
});

function cacheElements() {
  [
    "homeButton",
    "homeNewOcrProjectButton",
    "homeNewOcrFolderProjectButton",
    "homeBrowseOcrProjectsButton",
    "homeContinueOcrTaskButton",
    "homeNewTranslationProjectButton",
    "homeBrowseTranslationProjectsButton",
    "homeContinueTranslationTaskButton",
    "homeRefreshProjectsButton",
    "homeOcrStats",
    "homeTranslationStats",
    "homeProjectList",
    "fileLoadButton",
    "newProjectButton",
    "deleteProjectButton",
    "fileInput",
    "folderInput",
    "ocrModeSelect",
    "ocrProfileSelect",
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
    "viewerZoomOutButton",
    "viewerZoomInButton",
    "viewerZoomLabel",
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
    "batchOcrButton",
    "cancelBatchOcrButton",
    "batchOcrProgress",
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
  els.homeView = document.getElementById("homeView");
  els.workbenchView = document.getElementById("workbenchView");
  els.workspace = document.querySelector(".workspace");
  els.resizers = Array.from(document.querySelectorAll(".pane-resizer[data-resizer]"));
  els.paneCollapseButtons = Array.from(document.querySelectorAll("[data-collapse-pane]"));
}

function isCloudDeployment() {
  return window.location.protocol === "https:" || !["127.0.0.1", "localhost", ""].includes(window.location.hostname);
}

function configureDeploymentEndpoints() {
  if (!isCloudDeployment()) return;
  els.endpointInput.value = `${window.location.origin}/api/ocr`;
  els.aiOcrEndpointInput.value = `${window.location.origin}/api/ai-ocr`;
  els.translateEndpointInput.value = `${window.location.origin}/api/translate`;
}

function wireEvents() {
  bindOptionalClick("homeButton", () => showHomeView());
  bindOptionalClick("homeNewOcrProjectButton", () => startNewWorkflowProject("ocr"));
  bindOptionalClick("homeNewOcrFolderProjectButton", () => startNewOcrFolderProject());
  bindOptionalClick("homeBrowseOcrProjectsButton", () => browseHomeProjects("ocr"));
  bindOptionalClick("homeContinueOcrTaskButton", () => continueHomeTask("ocr"));
  bindOptionalClick("homeNewTranslationProjectButton", () => startNewWorkflowProject("translation"));
  bindOptionalClick("homeBrowseTranslationProjectsButton", () => browseHomeProjects("translation"));
  bindOptionalClick("homeContinueTranslationTaskButton", () => continueHomeTask("translation"));
  bindOptionalClick("homeRefreshProjectsButton", () => renderHomeDashboard());
  document.querySelectorAll("[data-workflow-card]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("button, a, input, select, textarea")) return;
      showWorkbenchView(card.dataset.workflowCard === "translation" ? "translation" : "ocr");
    });
  });

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

  if (els.folderInput) {
    els.folderInput.addEventListener("change", async (event) => {
      const files = Array.from(event.target.files || []);
      try {
        if (files.length) {
          await loadFolderProject(files);
        } else {
          setStatus("已取消文件夹选择。", "warn");
        }
      } catch (error) {
        console.error("Failed to load folder project", error);
        setStatus(`文件夹项目加载失败：${error.message || error}`, "error");
      } finally {
        state.pendingFolderProjectId = "";
        event.target.value = "";
      }
    });
  }

  els.prevButton.addEventListener("click", () => goToPage(state.pageNum - 1));
  els.nextButton.addEventListener("click", () => goToPage(state.pageNum + 1));
  els.viewerFirstPageButton.addEventListener("click", () => goToPage(1));
  els.viewerPrevPageButton.addEventListener("click", () => goToPage(state.pageNum - 1));
  els.viewerNextPageButton.addEventListener("click", () => goToPage(state.pageNum + 1));
  els.viewerLastPageButton.addEventListener("click", () => goToPage(state.pageCount));
  els.viewerZoomOutButton.addEventListener("click", () => setSourcePageZoom(state.sourcePageZoom - SOURCE_PAGE_ZOOM_STEP));
  els.viewerZoomInButton.addEventListener("click", () => setSourcePageZoom(state.sourcePageZoom + SOURCE_PAGE_ZOOM_STEP));

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
    setStatus(mode === "bdrc" ? "已切换到 BDRC 识别。" : "已切换到 Gemini Vision 识别。", "ok");
  });
  els.ocrProfileSelect.addEventListener("change", () => {
    const profile = getSelectedOcrProfile();
    state.ocrProfile = profile.id;
    saveCachedResults();
    setStatus(`资料类型已切换为“${profile.label}”，下次识别将使用 ${profile.model} 模型。`, "ok");
  });
  bindOptionalClick("checkTranslateButton", checkTranslateService);
  els.ocrButton.addEventListener("click", runOcrForCurrentPage);
  els.batchOcrButton.addEventListener("click", runOcrForRemainingPages);
  els.cancelBatchOcrButton.addEventListener("click", () => {
    if (state.batchOcr?.running) {
      state.batchOcr.cancelled = true;
      updateBatchOcrProgress();
    }
  });
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

function getWorkflowFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const workflow = params.get("workflow");
  return workflow === "ocr" || workflow === "translation" ? workflow : "home";
}

async function restoreRouteFromLocation() {
  const workflow = getWorkflowFromLocation();
  if (workflow === "ocr" || workflow === "translation") {
    showWorkbenchView(workflow, { updateRoute: false });
    await restoreActiveProjectForRoute(workflow);
    return;
  }
  showHomeView({ silent: true, updateRoute: false });
}

async function restoreActiveProjectForRoute(workflow) {
  if (hasActiveDocument() || state.activeProjectRestoreInFlight) return;
  const cacheKey = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
  if (!cacheKey || !cacheKey.startsWith(CACHE_PREFIX)) return;
  const project = parseCachedProject(cacheKey);
  if (!project) return;

  state.activeProjectRestoreInFlight = true;
  try {
    const sourceFile = await getStoredSourceFile(cacheKey);
    if (!sourceFile) {
      setStatus(`已找到“${project.sourceName}”的 OCR 缓存，但源文件缓存已丢失；请重新加载原始文件。`, "warn");
      return;
    }
    await loadFile(sourceFile);
    if (workflow === "ocr") setOcrView("proofread");
    setStatus(`已自动恢复“${sourceFile.name}”及已有 OCR/译文结果。`, "ok");
  } catch (error) {
    console.warn("Failed to auto-restore active OCR project", error);
    setStatus(`自动恢复项目失败：${error.message || error}。可从项目列表手动继续。`, "warn");
  } finally {
    state.activeProjectRestoreInFlight = false;
    refreshControls();
  }
}

function updateRouteForWorkflow(workflow, options = {}) {
  if (!window.history?.pushState || window.location.protocol === "file:") return;
  const normalized = workflow === "ocr" || workflow === "translation" ? workflow : "home";
  const url = new URL(window.location.href);
  if (normalized === "home") {
    url.searchParams.delete("workflow");
  } else {
    url.searchParams.set("workflow", normalized);
  }
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;
  const method = options.replace ? "replaceState" : "pushState";
  window.history[method]({ workflow: normalized }, "", nextUrl);
}

function showHomeView(options = {}) {
  state.activeWorkflow = "home";
  els.homeView.hidden = false;
  els.workbenchView.hidden = true;
  els.appShell.classList.add("home-mode", "ocr-only-mode");
  els.appShell.classList.add("ai-only-mode");
  els.appShell.classList.remove("workbench-mode", "translation-workflow");
  els.workspace.classList.add("ocr-only-mode");
  els.workspace.classList.remove("translation-enabled", "translation-workflow");
  setAppTitle("藏文典籍 OCR 对照工作台");
  renderHomeDashboard();
  if (!options.silent) {
    setStatus("", "");
  }
  if (options.updateRoute !== false) {
    updateRouteForWorkflow("home", { replace: options.replaceRoute });
  }
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function showWorkbenchView(workflow = "ocr", options = {}) {
  const isTranslation = workflow === "translation";
  state.activeWorkflow = isTranslation ? "translation" : "ocr";
  els.homeView.hidden = true;
  els.workbenchView.hidden = false;
  els.appShell.classList.remove("home-mode");
  els.appShell.classList.add("workbench-mode");
  els.appShell.classList.add("ai-only-mode");
  els.appShell.classList.toggle("ocr-only-mode", !isTranslation);
  els.appShell.classList.toggle("translation-workflow", isTranslation);
  els.workspace.classList.toggle("ocr-only-mode", !isTranslation);
  els.workspace.classList.toggle("translation-enabled", isTranslation);
  els.workspace.classList.toggle("translation-workflow", isTranslation);
  setAppTitle(isTranslation ? "藏译中工作台" : "藏文典籍 OCR 对照工作台");
  if (isTranslation) {
    state.layout.translationCollapsed = false;
    els.workspace.classList.remove("proofread-merged-view");
    els.ocrLineCompare.classList.remove("proofread-block-list");
    state.ocrView = "lines";
    clearSourceLineHighlight();
  } else {
    state.layout.translationCollapsed = true;
    setOcrView("proofread");
  }
  applyWorkspaceLayout();
  refreshControls();
  if (isTranslation) {
    updateTranslationPanelForPage();
  }
  if (options.updateRoute !== false) {
    updateRouteForWorkflow(state.activeWorkflow, { replace: options.replaceRoute });
  }
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function startNewWorkflowProject(workflow) {
  if (newProject()) {
    showWorkbenchView(workflow);
    if (!els.fileInput) {
      setStatus("文件选择控件未初始化，请刷新页面后重试。", "error");
      return;
    }
    els.fileInput.value = "";
    els.fileInput.click();
  }
}

function startNewOcrFolderProject() {
  if (!els.folderInput) {
    setStatus("文件夹选择控件未初始化，请刷新页面后重试。", "error");
    return;
  }
  if (state.isOcrBusy || state.isTranslateBusy) {
    setStatus("OCR 或翻译正在运行，请等当前任务结束后再新建项目。", "warn");
    return;
  }
  state.pendingFolderProjectId = "";
  els.folderInput.value = "";
  els.folderInput.click();
}

async function loadFolderProject(files) {
  const pdfFiles = files.filter(isPdfFile);
  if (!pdfFiles.length) {
    throw new Error("所选总文件夹中没有找到 PDF 分册。");
  }

  const manifest = makeFolderProjectManifest(pdfFiles, state.pendingFolderProjectId);
  state.folderProjectFiles.set(manifest.id, manifest.parts.map((part) => ({
    id: part.id,
    file: part.file,
  })));
  persistFolderProjectManifest(manifest);
  renderHomeDashboard();

  const firstPart = manifest.parts[0];
  if (!firstPart?.file) {
    setStatus(`已建立“${manifest.sourceName}”项目，但没有可打开的 PDF 分册。`, "warn");
    return;
  }

  state.activeFolderProjectId = manifest.id;
  showWorkbenchView("ocr");
  await loadFile(firstPart.file);
  state.activeFolderProjectId = manifest.id;
  setStatus(
    `已载入“${manifest.sourceName}”：${manifest.parts.length} 个 PDF 分册已纳入项目。当前打开第 1 个分册“${firstPart.file.name}”。`,
    "ok"
  );
}

function makeFolderProjectManifest(files, preferredId = "") {
  const rootName = inferFolderRootName(files);
  const parts = files
    .map((file, index) => makeFolderProjectPart(file, index))
    .sort(compareFolderProjectParts)
    .map((part, index) => ({
      ...part,
      order: index + 1,
      id: `${String(index + 1).padStart(4, "0")}-${slugifyProjectPart(part.relativePath || part.name)}`,
    }));
  const knownPages = parts.reduce((total, part) => total + (part.estimatedPages || 0), 0);
  const id = preferredId || makeFolderProjectId(rootName, parts);

  return {
    id,
    kind: "folder",
    workflow: "ocr",
    sourceName: rootName || "未命名藏文书籍",
    sourceMime: "folder/pdf-parts",
    sourceType: "pdf-folder",
    partCount: parts.length,
    pageCount: knownPages,
    hasEstimatedPageCount: knownPages > 0,
    updatedAt: new Date().toISOString(),
    parts,
  };
}

function makeFolderProjectPart(file, index) {
  const relativePath = file.webkitRelativePath || file.name;
  const range = parsePageRangeFromName(relativePath);
  const partNumber = parsePartNumberFromName(relativePath);
  return {
    name: file.name,
    relativePath,
    folderPath: relativePath.includes("/") ? relativePath.split("/").slice(0, -1).join("/") : "",
    pageStart: range?.start || 0,
    pageEnd: range?.end || 0,
    estimatedPages: range ? Math.max(1, range.end - range.start + 1) : 0,
    partNumber,
    fallbackOrder: index,
    file,
  };
}

function inferFolderRootName(files) {
  const firstPath = files.find((file) => file.webkitRelativePath)?.webkitRelativePath || "";
  const [root] = firstPath.split("/");
  if (root) return root;
  const firstFile = files[0];
  return firstFile?.name?.replace(/\.pdf$/i, "") || "未命名藏文书籍";
}

function compareFolderProjectParts(left, right) {
  if (left.pageStart && right.pageStart && left.pageStart !== right.pageStart) {
    return left.pageStart - right.pageStart;
  }
  if (left.partNumber && right.partNumber && left.partNumber !== right.partNumber) {
    return left.partNumber - right.partNumber;
  }
  return (left.relativePath || left.name).localeCompare(right.relativePath || right.name, "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function parsePageRangeFromName(value) {
  const normalized = String(value || "").replace(/[_\s]+/g, " ");
  const patterns = [
    /pages?\s*0*(\d{1,6})\s*[-_~至]\s*0*(\d{1,6})/i,
    /p(?:age)?\s*0*(\d{1,6})\s*[-_~至]\s*0*(\d{1,6})/i,
    /(?:^|[^\d])0*(\d{1,6})\s*[-_~至]\s*0*(\d{1,6})(?:[^\d]|$)/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
      return { start, end };
    }
  }
  return null;
}

function parsePartNumberFromName(value) {
  const match = String(value || "").match(/part[_\s-]*0*(\d{1,5})/i);
  return match ? Number(match[1]) : 0;
}

function makeFolderProjectId(rootName, parts) {
  const signature = [
    rootName || "book",
    parts.length,
    parts[0]?.relativePath || "",
    parts[parts.length - 1]?.relativePath || "",
  ].join("|");
  return `folder:${slugifyProjectPart(signature)}`;
}

function slugifyProjectPart(value) {
  return encodeURIComponent(String(value || "part").toLowerCase())
    .replace(/%/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "part";
}

function persistFolderProjectManifest(manifest) {
  const stored = getStoredFolderProjects().filter((project) => project.id !== manifest.id);
  const cleanParts = manifest.parts.map(({ file: _file, ...part }) => part);
  stored.unshift({
    ...manifest,
    parts: cleanParts,
  });
  window.localStorage.setItem(FOLDER_PROJECTS_KEY, JSON.stringify(stored.slice(0, 50)));
}

function getStoredFolderProjects() {
  try {
    const raw = window.localStorage.getItem(FOLDER_PROJECTS_KEY);
    const projects = JSON.parse(raw || "[]");
    return Array.isArray(projects) ? projects.filter((project) => project?.kind === "folder") : [];
  } catch (error) {
    console.warn("Failed to parse folder projects", error);
    return [];
  }
}

function setAppTitle(title) {
  const heading = document.querySelector(".brand h1");
  if (heading) {
    heading.textContent = title;
  }
  document.title = title;
}

function browseHomeProjects(filter = "all", options = {}) {
  if (state.activeWorkflow !== "home") {
    showHomeView({ silent: true });
  }
  state.homeProjectFilter = HOME_PROJECT_FILTERS.has(filter) ? filter : "all";
  renderHomeDashboard();
  els.homeProjectList?.scrollIntoView({ block: "start", behavior: "smooth" });
  if (!options.silent) {
    const label = filter === "translation" ? "藏译中项目" : filter === "ocr" ? "OCR 项目" : "本机项目";
    setStatus(`已显示${label}列表，请在下方选择要继续的项目。`, "ok");
  }
}

function continueHomeTask(workflow) {
  const projects = getHomeProjects();
  const predicate = workflow === "translation" ? isTranslationProjectInProgress : isOcrProjectInProgress;
  const candidates = projects.filter(predicate);
  const label = workflow === "translation" ? "正在翻译的项目" : "正在校对的项目";

  if (candidates.length > 1) {
    browseHomeProjects(workflow, { silent: true });
    setStatus(`找到 ${candidates.length} 个${label}，请在下方项目列表中选择一个继续。`, "warn");
    return;
  }

  if (candidates.length === 1) {
    openHomeProject(candidates[0], workflow);
    return;
  }

  browseHomeProjects(workflow, { silent: true });
  setStatus(workflow === "translation" ? "没有正在翻译的任务。可以新建翻译项目，或先加载已有源文件。" : "没有正在校对的任务。可以新建 OCR 项目，或先加载已有源文件。", "warn");
}

function requestCachedProjectSource(project, workflow = "ocr") {
  if (isCloudDeployment() && project.remoteBookId) {
    resumeRemoteProject(project, workflow);
    return;
  }
  resumeLocalProject(project, workflow);
}

async function resumeLocalProject(project, workflow = "ocr") {
  try {
    const sourceFile = await getStoredSourceFile(project.cacheKey);
    if (sourceFile) {
      showWorkbenchView(workflow);
      await loadFile(sourceFile);
      if (workflow === "ocr") setOcrView("proofread");
      setStatus(`已恢复“${sourceFile.name}”及本机校对进度。`, "ok");
      return;
    }
  } catch (error) {
    console.warn("Failed to restore cached source file", error);
  }
  showWorkbenchView(workflow);
  setStatus(
    `项目“${project.sourceName}”的浏览器源文件缓存已丢失，请点击“加载文件”重新选择原始文件；已有 OCR/译文记录仍会保留。`,
    "warn",
  );
}

function openSourceDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("当前浏览器不支持本地源文件缓存"));
      return;
    }
    const request = window.indexedDB.open(SOURCE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SOURCE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地源文件缓存"));
  });
}

async function storeSourceFile(cacheKey, file) {
  if (!cacheKey || !file || !window.indexedDB) return;
  const database = await openSourceDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(SOURCE_STORE_NAME, "readwrite");
    transaction.objectStore(SOURCE_STORE_NAME).put(file, cacheKey);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("无法保存源文件"));
  });
  database.close();
}

async function getStoredSourceFile(cacheKey) {
  if (!cacheKey || !window.indexedDB) return null;
  const database = await openSourceDatabase();
  const file = await new Promise((resolve, reject) => {
    const transaction = database.transaction(SOURCE_STORE_NAME, "readonly");
    const request = transaction.objectStore(SOURCE_STORE_NAME).get(cacheKey);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("无法读取源文件"));
  });
  database.close();
  return file;
}

async function removeStoredSourceFile(cacheKey) {
  if (!cacheKey || !window.indexedDB) return;
  const database = await openSourceDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(SOURCE_STORE_NAME, "readwrite");
    transaction.objectStore(SOURCE_STORE_NAME).delete(cacheKey);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("无法删除源文件缓存"));
  });
  database.close();
}

async function resumeRemoteProject(project, workflow = "ocr") {
  showWorkbenchView(workflow);
  setStatus(`正在恢复云端项目“${project.sourceName}”...`, "warn");
  try {
    const baseUrl = window.location.origin;
    const [sourceResponse, stateResponse] = await Promise.all([
      fetch(`${baseUrl}/api/books/${encodeURIComponent(project.remoteBookId)}/source`),
      fetch(`${baseUrl}/api/books/${encodeURIComponent(project.remoteBookId)}/state`),
    ]);
    if (!sourceResponse.ok) throw new Error(`源文件 HTTP ${sourceResponse.status}`);
    const remoteState = await stateResponse.json().catch(() => ({}));
    if (!stateResponse.ok) throw new Error(remoteState.detail || `状态 HTTP ${stateResponse.status}`);
    const sourceBlob = await sourceResponse.blob();
    const sourceName = project.sourceName || remoteState.name || "远程项目.pdf";
    const sourceFile = new File([sourceBlob], sourceName, {
      type: sourceBlob.type || project.sourceMime || remoteState.content_type || "application/pdf",
    });
    const cacheKey = makeCacheKey(sourceFile);
    window.localStorage.setItem(cacheKey, JSON.stringify({
      sourceName,
      sourceSize: sourceFile.size,
      sourceMime: sourceFile.type,
      pageCount: Number(remoteState.page_count || remoteState.pageCount || project.pageCount || 0),
      updatedAt: remoteState.updated_at || remoteState.updatedAt || new Date().toISOString(),
      remoteBookId: project.remoteBookId,
      ocrProfile: remoteState.ocr_profile || remoteState.ocrProfile || DEFAULT_OCR_PROFILE,
      ocrResults: remoteState.ocr_results || remoteState.ocrResults || {},
      translationResults: remoteState.translation_results || remoteState.translationResults || {},
    }));
    await loadFile(sourceFile, { skipRemoteUpload: true, remoteBookId: project.remoteBookId });
    setStatus(`已恢复“${sourceName}”及云端校对进度。`, "ok");
  } catch (error) {
    setStatus(`云端项目恢复失败：${error.message || error}`, "error");
  }
}

function renderHomeDashboard() {
  const projects = getHomeProjects();
  const ocrInProgress = projects.filter(isOcrProjectInProgress).length;
  const translationInProgress = projects.filter(isTranslationProjectInProgress).length;
  const ocrReady = projects.filter((project) => project.ocrCount > 0).length;
  const translationReady = projects.filter((project) => project.translationCount > 0).length;

  if (els.homeOcrStats) {
    els.homeOcrStats.textContent = projects.length
      ? `${projects.length} 个本机项目，${ocrInProgress} 个正在校对，${ocrReady} 个已有 OCR 结果`
      : "暂无本机项目";
  }
  if (els.homeTranslationStats) {
    els.homeTranslationStats.textContent = projects.length
      ? `${projects.length} 个本机项目，${translationInProgress} 个正在翻译，${translationReady} 个已有译文`
      : "暂无本机项目";
  }
  setOptionalDisabled("homeContinueOcrTaskButton", ocrInProgress === 0);
  setOptionalDisabled("homeContinueTranslationTaskButton", translationInProgress === 0);
  renderHomeProjectList(projects);
}

function renderHomeProjectList(projects) {
  if (!els.homeProjectList) return;
  const filter = HOME_PROJECT_FILTERS.has(state.homeProjectFilter) ? state.homeProjectFilter : "all";
  const filtered = projects.filter((project) => {
    if (filter === "ocr") return project.ocrCount > 0 || project.pageCount > 0;
    if (filter === "translation") return project.translationCount > 0 || project.pageCount > 0;
    return true;
  });
  els.homeProjectList.innerHTML = "";

  const summary = document.createElement("div");
  summary.className = "home-project-filter-summary";
  summary.textContent = makeHomeProjectFilterSummary(filter, filtered.length, projects.length);
  els.homeProjectList.appendChild(summary);

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "home-project-empty";
    empty.textContent = filter === "translation"
      ? "还没有可浏览的藏译中项目。"
      : filter === "ocr"
        ? "还没有可浏览的 OCR 项目。"
        : "还没有本机项目。";
    els.homeProjectList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach((project) => {
    const card = document.createElement("article");
    card.className = "home-project-card";

    const projectId = project.kind === "folder" ? project.id : project.cacheKey;
    const titleRow = document.createElement("div");
    titleRow.className = "home-project-title-row";
    const title = document.createElement("h4");
    title.textContent = project.sourceName || "未命名项目";
    const deleteButton = document.createElement("button");
    deleteButton.className = "ghost-button compact danger-action home-project-delete";
    deleteButton.type = "button";
    deleteButton.innerHTML = '<i data-lucide="trash-2"></i><span>删除项目</span>';
    deleteButton.title = `删除“${project.sourceName || "未命名项目"}”的浏览器项目记录`;
    deleteButton.addEventListener("click", () => {
      state.pendingHomeProjectDeletionId = projectId;
      renderHomeDashboard();
    });
    titleRow.append(title, deleteButton);

    const deleteConfirm = document.createElement("div");
    deleteConfirm.className = "home-project-delete-confirm";
    deleteConfirm.hidden = state.pendingHomeProjectDeletionId !== projectId;
    const confirmText = document.createElement("span");
    confirmText.textContent = "删除此浏览器项目？";
    const confirmButton = document.createElement("button");
    confirmButton.className = "ghost-button compact danger-action";
    confirmButton.type = "button";
    confirmButton.textContent = "确认删除";
    confirmButton.addEventListener("click", () => {
      void deleteHomeProject(project);
    });
    const cancelButton = document.createElement("button");
    cancelButton.className = "ghost-button compact";
    cancelButton.type = "button";
    cancelButton.textContent = "取消";
    cancelButton.addEventListener("click", () => {
      state.pendingHomeProjectDeletionId = "";
      renderHomeDashboard();
    });
    deleteConfirm.append(confirmText, confirmButton, cancelButton);

    const meta = document.createElement("div");
    meta.className = "home-project-meta";
    meta.append(
      makeHomePill(makeProjectPageLabel(project)),
      makeHomePill(project.sourceMime || project.sourceType || "本机缓存"),
      makeHomePill(formatHomeDate(project.updatedAt)),
    );
    if (project.kind === "folder") {
      meta.append(makeHomePill(`${project.partCount || 0} 个 PDF 分册`));
    }

    const progress = document.createElement("div");
    progress.className = "home-project-progress";
    if (project.kind === "folder") {
      progress.append(makeHomePill(makeFolderProjectRangeLabel(project)));
    } else {
      progress.append(
        makeHomePill(`OCR ${project.ocrCount}/${project.pageCount || 0}`),
        makeHomePill(`译文 ${project.translationCount}/${project.pageCount || 0}`),
      );
    }

    const actions = document.createElement("div");
    actions.className = "home-project-actions";
    if (project.kind === "folder") {
      actions.append(
        makeHomeProjectButton("打开首个分册", "scan-text", () => openFolderProject(project, "ocr")),
        makeHomeProjectButton("重选总文件夹", "folder-open", () => requestFolderProjectSource(project)),
      );
    } else {
      actions.append(
        makeHomeProjectButton("继续校对", "scan-text", () => openHomeProject(project, "ocr")),
        makeHomeProjectButton("继续翻译", "languages", () => openHomeProject(project, "translation")),
      );
    }

    card.append(titleRow, deleteConfirm, meta, progress);
    if (project.kind === "folder") {
      card.append(makeFolderProjectPartsList(project));
    }
    card.append(actions);
    fragment.appendChild(card);
  });
  els.homeProjectList.appendChild(fragment);
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

async function deleteHomeProject(project) {
  if (state.isOcrBusy || state.isTranslateBusy) {
    setStatus("OCR 或翻译正在运行，请等当前任务结束后再删除项目。", "warn");
    return;
  }

  const projectName = project.sourceName || "未命名项目";
  try {
    if (project.kind === "folder") {
      const remaining = getStoredFolderProjects().filter((item) => item.id !== project.id);
      window.localStorage.setItem(FOLDER_PROJECTS_KEY, JSON.stringify(remaining));
      state.folderProjectFiles.delete(project.id);
      if (state.activeFolderProjectId === project.id) state.activeFolderProjectId = "";
    } else {
      window.localStorage.removeItem(project.cacheKey);
      await removeStoredSourceFile(project.cacheKey);
      if (window.localStorage.getItem(ACTIVE_PROJECT_KEY) === project.cacheKey) {
        window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
      }
      if (project.isActive || state.cacheKey === project.cacheKey) {
        resetDocumentState();
      }
    }
    state.pendingHomeProjectDeletionId = "";
    setStatus(`已删除“${projectName}”的浏览器项目记录。云端文件未删除。`, "ok");
    renderHomeDashboard();
  } catch (error) {
    console.error("Failed to delete home project", error);
    setStatus(`删除“${projectName}”失败：${error.message || error}`, "error");
  }
}

function makeHomeProjectFilterSummary(filter, filteredCount, totalCount) {
  if (filter === "ocr") {
    return `正在显示 OCR 项目：${filteredCount} / ${totalCount}。点击项目卡片中的“继续校对”进入指定项目。`;
  }
  if (filter === "translation") {
    return `正在显示藏译中项目：${filteredCount} / ${totalCount}。点击项目卡片中的“继续翻译”进入指定项目。`;
  }
  return `正在显示全部本机项目：${filteredCount} / ${totalCount}。`;
}

function openHomeProject(project, workflow) {
  if (project.kind === "folder") {
    openFolderProject(project, workflow);
    return;
  }
  if (project.isActive) {
    showWorkbenchView(workflow);
    if (workflow === "ocr") {
      setOcrView("proofread");
    }
    return;
  }
  requestCachedProjectSource(project, workflow);
}

async function openFolderProject(project, workflow = "ocr") {
  const sessionParts = state.folderProjectFiles.get(project.id) || [];
  const firstPart = sessionParts[0];
  if (!firstPart?.file) {
    requestFolderProjectSource(project);
    return;
  }
  state.activeFolderProjectId = project.id;
  showWorkbenchView(workflow === "translation" ? "translation" : "ocr");
  await loadFile(firstPart.file);
  state.activeFolderProjectId = project.id;
  setStatus(`已打开“${project.sourceName}”的第 1 个 PDF 分册。当前版本先以分册为单位校对。`, "ok");
}

function requestFolderProjectSource(project) {
  if (!els.folderInput) {
    setStatus("文件夹选择控件未初始化，请刷新页面后重试。", "error");
    return;
  }
  state.pendingFolderProjectId = project.id;
  setStatus(`请选择“${project.sourceName}”的总文件夹，以恢复 ${project.partCount || 0} 个 PDF 分册。`, "warn");
  els.folderInput.value = "";
  els.folderInput.click();
}

function makeProjectPageLabel(project) {
  if (project.kind === "folder" && !project.hasEstimatedPageCount) {
    return "页数待加载";
  }
  return `${project.pageCount || 0} 页`;
}

function makeFolderProjectRangeLabel(project) {
  const parts = Array.isArray(project.parts) ? project.parts : [];
  const ranges = parts
    .filter((part) => part.pageStart && part.pageEnd)
    .slice(0, 2)
    .map((part) => `${part.pageStart}-${part.pageEnd}`);
  if (!ranges.length) {
    return "未识别页码范围，按文件名排序";
  }
  const suffix = parts.length > 2 ? ` 等 ${parts.length} 段` : "";
  return `页码范围 ${ranges.join("、")}${suffix}`;
}

function makeFolderProjectPartsList(project) {
  const list = document.createElement("div");
  list.className = "home-folder-parts";
  const parts = Array.isArray(project.parts) ? project.parts.slice(0, 8) : [];
  parts.forEach((part) => {
    const item = document.createElement("span");
    item.textContent = formatFolderProjectPartLabel(part);
    list.appendChild(item);
  });
  if ((project.parts?.length || 0) > parts.length) {
    const more = document.createElement("span");
    more.textContent = `另 ${project.parts.length - parts.length} 个分册`;
    list.appendChild(more);
  }
  return list;
}

function formatFolderProjectPartLabel(part) {
  const range = part.pageStart && part.pageEnd ? ` pages ${part.pageStart}-${part.pageEnd}` : "";
  const folder = part.folderPath ? `${part.folderPath}/` : "";
  return `${String(part.order || "").padStart(2, "0")} ${folder}${part.name}${range}`;
}

function makeHomePill(text) {
  const item = document.createElement("span");
  item.textContent = text;
  return item;
}

function makeHomeProjectButton(label, icon, handler) {
  const button = document.createElement("button");
  button.className = "ghost-button compact";
  button.type = "button";
  button.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>`;
  button.addEventListener("click", handler);
  return button;
}

function getHomeProjects() {
  const projects = [];
  const activeProject = getActiveHomeProject();
  if (activeProject) {
    projects.push(activeProject);
  }

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(CACHE_PREFIX)) continue;
    const project = parseCachedProject(key);
    if (!project) continue;
    if (activeProject?.cacheKey === project.cacheKey) continue;
    projects.push(project);
  }

  for (const folderProject of getStoredFolderProjects()) {
    projects.push(parseStoredFolderProject(folderProject));
  }

  return projects.sort((left, right) => {
    if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
    return (Date.parse(right.updatedAt || "") || 0) - (Date.parse(left.updatedAt || "") || 0);
  });
}

function getActiveHomeProject() {
  if (!hasActiveDocument()) return null;
  return {
    cacheKey: state.cacheKey || "active",
    sourceName: state.sourceName || "当前项目",
    sourceSize: state.sourceSize,
    sourceMime: state.sourceMime,
    remoteBookId: state.remoteBookId,
    pageCount: state.pageCount || 0,
    updatedAt: new Date().toISOString(),
    ocrCount: [...state.ocrResults.values()].filter((result) => (result.text || "").trim()).length,
    translationCount: [...state.translationResults.values()].filter((result) => (result.text || "").trim()).length,
    isActive: true,
  };
}

function parseCachedProject(cacheKey) {
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    const pageCount = Number(payload.pageCount) || 0;
    const ocrCount = Object.values(payload.ocrResults || {}).filter((result) => (result?.text || "").trim()).length;
    const translationCount = Object.values(payload.translationResults || {}).filter((result) => (result?.text || "").trim()).length;
    return {
      cacheKey,
      sourceName: payload.sourceName || decodeCacheProjectName(cacheKey),
      sourceSize: Number(payload.sourceSize) || 0,
      sourceMime: payload.sourceMime || "",
      pageCount,
      updatedAt: payload.updatedAt || "",
      remoteBookId: payload.remoteBookId || "",
      ocrCount,
      translationCount,
      isActive: false,
    };
  } catch (error) {
    console.warn("Failed to parse cached project", cacheKey, error);
    return null;
  }
}

function parseStoredFolderProject(project) {
  const pageCount = Number(project.pageCount) || 0;
  return {
    ...project,
    cacheKey: project.id,
    sourceName: project.sourceName || "未命名藏文书籍",
    sourceMime: project.sourceMime || "folder/pdf-parts",
    sourceType: project.sourceType || "pdf-folder",
    pageCount,
    partCount: Number(project.partCount) || project.parts?.length || 0,
    ocrCount: 0,
    translationCount: 0,
    isActive: state.activeFolderProjectId === project.id,
    kind: "folder",
  };
}

function decodeCacheProjectName(cacheKey) {
  const rest = cacheKey.slice(CACHE_PREFIX.length);
  const [encodedName] = rest.split(":");
  try {
    return decodeURIComponent(encodedName || "") || "未命名项目";
  } catch (_error) {
    return "未命名项目";
  }
}

function isOcrProjectInProgress(project) {
  return Boolean(project.pageCount && project.ocrCount > 0 && project.ocrCount < project.pageCount);
}

function isTranslationProjectInProgress(project) {
  return Boolean(project.pageCount && project.translationCount > 0 && project.translationCount < project.pageCount);
}

function formatHomeDate(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "未记录时间";
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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
    "当前通过 file:// 打开，PDF worker、缓存和本地 OCR/Gemini Vision 接口可能不稳定；请使用 http://127.0.0.1:8790/tibetan-proofreading-app/ 打开。",
    "error"
  );
}

function restoreOcrFontSize() {
  const storedSize = Number(window.localStorage.getItem(OCR_FONT_SIZE_KEY));
  setOcrFontSize(Number.isFinite(storedSize) ? storedSize : state.ocrFontSize, false);
}

function restoreSourcePreviewScale() {
  const storedScale = Number(window.localStorage.getItem(SOURCE_PREVIEW_SCALE_KEY));
  setSourcePreviewScale(Number.isFinite(storedScale) ? storedScale : state.sourcePreviewScale, false);
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
  next.proofreadViewer = clamp(safeNumber(next.proofreadViewer, next.viewer), 0.55, 2.4);
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
  return !els.appShell?.classList.contains("translation-workflow");
}

function applyWorkspaceLayout() {
  state.layout = normalizeWorkspaceLayout(state.layout);
  const ocrOnly = isOcrOnlyWorkspace();
  const collapsed = state.layout.collapsed;
  if (ocrOnly) {
    state.layout.translationCollapsed = true;
    els.workspace.classList.add("ocr-only-mode");
    els.appShell?.classList.add("ocr-only-mode");
  } else {
    els.workspace.classList.remove("ocr-only-mode");
    els.appShell?.classList.remove("ocr-only-mode");
  }

  els.workspace.style.setProperty("--viewer-min", collapsed.viewer ? "52px" : "300px");
  els.workspace.style.setProperty("--ocr-min", collapsed.ocr ? "52px" : "240px");
  els.workspace.style.setProperty("--ai-ocr-min", collapsed.ai ? "52px" : "240px");
  els.workspace.style.setProperty("--viewer-width", collapsed.viewer ? "52px" : `${state.layout.viewer}fr`);
  els.workspace.style.setProperty(
    "--proofread-viewer-width",
    collapsed.viewer ? "52px" : `${state.layout.proofreadViewer}fr`,
  );
  els.workspace.style.setProperty("--ocr-width", collapsed.ocr ? "52px" : `${state.layout.ocr}fr`);
  els.workspace.style.setProperty("--ai-ocr-width", collapsed.ai ? "52px" : `${state.layout.ai}fr`);
  els.workspace.style.setProperty(
    "--translation-width",
    state.layout.translationCollapsed || ocrOnly ? "0px" : `${state.layout.translation}fr`,
  );
  els.workspace.classList.toggle("translation-collapsed", state.layout.translationCollapsed || ocrOnly);
  els.workspace.classList.toggle("translation-enabled", !ocrOnly);
  els.workspace.classList.toggle("translation-workflow", !ocrOnly && state.activeWorkflow === "translation");
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
    ocr: ["Gemini Vision OCR 栏", "panel-left"],
    ai: ["Gemini Vision 栏", "panel-right"],
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
    mergedResult: 420,
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
      const mergedViewerResize =
        resizer.dataset.resizer === "viewer-ocr" &&
        els.workspace.classList.contains("proofread-merged-view");
      const viewerRect = mergedViewerResize
        ? els.workspace.querySelector(".viewer-pane")?.getBoundingClientRect()
        : null;
      const mergedResultRect = mergedViewerResize
        ? els.workspace.querySelector(".ocr-pane")?.getBoundingClientRect()
        : null;
      const mergedPairWidth = (viewerRect?.width || 0) + (mergedResultRect?.width || 0);
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

      event.preventDefault();
      document.body.classList.add("is-resizing-panes");

      const onMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;

        if (mergedViewerResize) {
          if (collapsed.viewer || collapsed.ocr || !viewerRect || mergedPairWidth <= 0) return;
          const nextViewer = clamp(
            viewerRect.width + delta,
            minimums.viewer,
            mergedPairWidth - minimums.mergedResult,
          );
          const nextMergedResult = mergedPairWidth - nextViewer;
          state.layout.proofreadViewer = nextViewer / nextMergedResult;
          applyWorkspaceLayout();
          return;
        }

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
        document.body.classList.remove("is-resizing-panes");
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

function setSourcePreviewScale(scale, persist = true, rerender = false) {
  const nextScale = clamp(
    Math.round((Number(scale) || 1) * 100) / 100,
    SOURCE_PREVIEW_SCALE_MIN,
    SOURCE_PREVIEW_SCALE_MAX,
  );
  state.sourcePreviewScale = nextScale;
  document.documentElement.style.setProperty("--source-preview-scale", String(nextScale));
  document.documentElement.style.setProperty(
    "--source-preview-min-height",
    `${Math.round(88 * nextScale)}px`,
  );
  document.documentElement.style.setProperty(
    "--source-preview-max-height",
    `${Math.round(116 * nextScale)}px`,
  );
  if (persist) {
    window.localStorage.setItem(SOURCE_PREVIEW_SCALE_KEY, String(nextScale));
  }
  if (rerender && state.ocrView === "proofread") {
    const scrollTop = els.ocrLineCompare.scrollTop;
    renderCurrentOcrView();
    els.ocrLineCompare.scrollTop = scrollTop;
    return;
  }
  updateSourcePreviewScaleButtons();
}

function setSourcePageZoom(zoom) {
  state.sourcePageZoom = clamp(
    Math.round((Number(zoom) || 1) * 100) / 100,
    SOURCE_PAGE_ZOOM_MIN,
    SOURCE_PAGE_ZOOM_MAX,
  );
  applySourcePageZoom();
}

function applySourcePageZoom() {
  const zoom = state.sourcePageZoom || 1;
  els.viewerZoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  els.viewerZoomOutButton.disabled = zoom <= SOURCE_PAGE_ZOOM_MIN;
  els.viewerZoomInButton.disabled = zoom >= SOURCE_PAGE_ZOOM_MAX;
  const image = els.imagePage;
  if (image.style.display !== "none" && image.naturalWidth) {
    const fitWidth = Math.min(image.naturalWidth, Math.max(320, els.pageViewport.clientWidth - 36));
    image.style.maxWidth = "none";
    image.style.width = `${Math.round(fitWidth * zoom)}px`;
  }
  renderSourceBlockOverlay();
}

function updateSourcePreviewScaleButtons() {
  const currentPercent = Math.round(state.sourcePreviewScale * 100);
  document.querySelectorAll(".source-preview-scale-button").forEach((button) => {
    const action = button.dataset.scaleAction;
    const isDecrease = action === "decrease";
    const isIncrease = action === "increase";
    button.disabled =
      (isDecrease && state.sourcePreviewScale <= SOURCE_PREVIEW_SCALE_MIN) ||
      (isIncrease && state.sourcePreviewScale >= SOURCE_PREVIEW_SCALE_MAX);
    button.title = `${isDecrease ? "缩小" : "放大"}原文 block 预览（当前 ${currentPercent}%）`;
  });
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

async function loadFile(file, options = {}) {
  if (state.batchOcr?.running) throw new Error("请先停止批量识别，再加载其他文件。");
  if (!isSupportedSourceFile(file)) {
    throw new Error("只支持 PDF、图片、Markdown、TXT 或 DOCX 文件。");
  }

  setStatus(`正在载入 ${file.name || "所选文件"}...`, "warn");
  resetDocumentState();
  state.sourceName = file.name;
  state.sourceSize = file.size || 0;
  state.sourceMime = file.type || "";
  state.cacheKey = makeCacheKey(file);
  window.localStorage.setItem(ACTIVE_PROJECT_KEY, state.cacheKey);
  storeSourceFile(state.cacheKey, file).catch((error) => {
    console.warn("Failed to store source file locally", error);
  });
  if (options.remoteBookId) {
    state.remoteBookId = options.remoteBookId;
  }

  if (isCloudDeployment() && !options.skipRemoteUpload) {
    void createRemoteBook(file)
      .then(() => {
        saveCachedResults();
      })
      .catch((error) => {
        console.warn("Failed to create remote book; continuing with local file", error);
        setStatus(
          `文件已在当前浏览器载入，但云端书籍保存失败：${error.message || error}`,
          "warn"
        );
      });
  }

  if (isPdfFile(file)) {
    await loadPdf(file);
    saveCachedResults();
    return;
  }

  if (isWordFile(file)) {
    await loadWord(file);
    saveCachedResults();
    return;
  }

  if (file.type.startsWith("image/")) {
    await loadImage(file);
    saveCachedResults();
    return;
  }

  if (isMarkdownFile(file)) {
    await loadMarkdown(file);
    saveCachedResults();
    return;
  }

  throw new Error("只支持 PDF、图片、Markdown、TXT 或 DOCX 文件。");
}

function isSupportedSourceFile(file) {
  return Boolean(file) && (isPdfFile(file) || isWordFile(file) || file.type.startsWith("image/") || isMarkdownFile(file));
}

function hasActiveDocument() {
  return Boolean(state.pageCount || state.sourceName || state.cacheKey);
}

function newProject() {
  if (state.isOcrBusy || state.isTranslateBusy) {
    setStatus("OCR 或翻译正在运行，请等当前任务结束后再新建项目。", "warn");
    return false;
  }

  if (hasActiveDocument()) {
    const ok = window.confirm(
      `新建项目会关闭当前工作台中的“${state.sourceName || "未命名项目"}”。本地缓存不会被删除，源文件也不会被删除。是否继续？`
    );
    if (!ok) {
      setStatus("已取消新建项目。当前工作台保持不变。", "warn");
      return false;
    }
  }

  window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
  resetDocumentState();
  setStatus("已新建空白项目。请点击“加载文件”开始。", "ok");
  renderHomeDashboard();
  return true;
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
    if (window.localStorage.getItem(ACTIVE_PROJECT_KEY) === cacheKey) {
      window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
  }
  resetDocumentState();
  setStatus(`已删除“${projectName}”的本地项目缓存。源文件未删除。`, "ok");
  renderHomeDashboard();
}

function isMarkdownFile(file) {
  const name = file.name.toLowerCase();
  return file.type === "text/markdown" ||
    file.type === "text/plain" ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    name.endsWith(".txt");
}

function isPdfFile(file) {
  return file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");
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

  state.pdfFile = file;
  state.pdfUrl = URL.createObjectURL(file);
  const task = window.pdfjsLib.getDocument({
    url: state.pdfUrl,
    disableFontFace: false,
    useSystemFonts: true,
    fontExtraProperties: true,
  });
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
  state.batchOcr = null;
  state.thumbnailToken += 1;
  clearSourceBlockOverlay();

  if (state.pdfUrl) {
    URL.revokeObjectURL(state.pdfUrl);
  }
  if (state.pdfPageRenderUrl) {
    URL.revokeObjectURL(state.pdfPageRenderUrl);
  }
  state.pdfPageRenderCache.forEach((entry) => {
    if (entry?.url) {
      URL.revokeObjectURL(entry.url);
    }
  });
  if (state.imageUrl) {
    URL.revokeObjectURL(state.imageUrl);
  }

  state.pdfDoc = null;
  state.pdfUrl = "";
  state.pdfFile = null;
  state.pdfPageRenderUrl = "";
  state.pdfPageRenderCache.clear();
  state.imageUrl = "";
  state.imageBlob = null;
  state.markdownText = "";
  state.documentText = "";
  state.sourceName = "";
  state.sourceSize = 0;
  state.sourceMime = "";
  state.cacheKey = "";
  state.sourceType = "";
  state.activeFolderProjectId = "";
  state.pageNum = 1;
  state.pageCount = 0;
  state.ocrResults.clear();
  state.ocrProfile = DEFAULT_OCR_PROFILE;
  state.translationResults.clear();
  state.ocrQualityReviews = [];
  state.remoteBookId = "";
  if (state.remoteSaveTimer) {
    window.clearTimeout(state.remoteSaveTimer);
    state.remoteSaveTimer = null;
  }
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
  if (els.ocrProfileSelect) {
    els.ocrProfileSelect.value = DEFAULT_OCR_PROFILE;
  }
}

function makeCacheKey(file) {
  const type = file.type || "unknown";
  const size = file.size || 0;
  return `${CACHE_PREFIX}${encodeURIComponent(file.name)}:${size}:${encodeURIComponent(type)}`;
}

function sanitizeCachedSourceLines(lines, layoutVersion) {
  const records = Array.isArray(lines) ? lines : [];
  return records.map((line, index) => ({
    ...line,
    bbox: normalizeBbox(line?.bbox),
    bboxApproximate: Boolean(line?.bboxApproximate || line?.bbox_approximate),
          reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
    index,
  }));
}

function sanitizeCachedSourceCoordinates(compare, layoutVersion) {
  const normalized = normalizeOcrCompare(compare);
  if (!normalized) return normalized;
  const clearSide = (side) => side ? {
    ...side,
    lines: (side.lines || []).map((line, index) => ({
      ...line,
      bbox: normalizeBbox(line?.bbox),
      bboxApproximate: Boolean(line?.bboxApproximate || line?.bbox_approximate),
          reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
      index,
    })),
    regions: normalizeOcrRegions(side.regions),
  } : side;
  return {
    ...normalized,
    bdrc: clearSide(normalized.bdrc),
    llm: clearSide(normalized.llm),
  };
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
    if (OCR_PROFILES[payload.ocrProfile]) {
      state.ocrProfile = payload.ocrProfile;
      if (els.ocrProfileSelect) els.ocrProfileSelect.value = state.ocrProfile;
    }
    state.ocrQualityReviews = normalizeOcrQualityReviews(payload.ocrQualityReviews);

    let droppedBadPdfTextCount = 0;
    for (const [page, result] of Object.entries(payload.ocrResults || {})) {
      const pageNum = Number(page);
      if (!isValidPageNumber(pageNum) || typeof result?.text !== "string") continue;
      if (result.source === "pdf-text" && !isUsablePdfDirectText(result.text)) {
        droppedBadPdfTextCount += 1;
        continue;
      }
      state.ocrResults.set(pageNum, {
        text: result.text,
        raw: result.raw || null,
        compare: sanitizeCachedSourceCoordinates(result.compare, result.layoutVersion),
        lines: sanitizeCachedSourceLines(result.lines, result.layoutVersion),
        regions: normalizeOcrRegions(result.regions),
        regionOrder: normalizeRegionOrder(result.regionOrder),
        layoutVersion: Number(result.layoutVersion) === SOURCE_LAYOUT_VERSION ? SOURCE_LAYOUT_VERSION : 0,
        ocrProfile: OCR_PROFILES[result.ocrProfile] ? result.ocrProfile : "",
        source: result.source || "cache",
        updatedAt: result.updatedAt || payload.updatedAt || "",
      });
      seedChatGptDialogOpenAiReview(pageNum, state.ocrResults.get(pageNum));
    }
    if (droppedBadPdfTextCount > 0) {
      window.localStorage.removeItem(state.cacheKey);
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

function saveCachedResults(options = {}) {
  if (!state.cacheKey || !state.pageCount) return;

  try {
    const payload = {
      sourceName: state.sourceName,
      sourceSize: state.sourceSize,
      sourceMime: state.sourceMime,
      pageCount: state.pageCount,
      updatedAt: new Date().toISOString(),
      remoteBookId: state.remoteBookId,
      ocrProfile: state.ocrProfile,
      ocrResults: serializeResultMap(state.ocrResults),
      translationResults: serializeResultMap(state.translationResults),
      ocrQualityReviews: state.ocrQualityReviews,
    };
    window.localStorage.setItem(state.cacheKey, JSON.stringify(payload));
    const remoteSave = scheduleRemoteStateSave(payload, options.immediateRemote);
    renderHomeDashboard();
    return remoteSave;
  } catch (error) {
    console.warn("Failed to save cached OCR state", error);
  }
}

async function createRemoteBook(file) {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const response = await fetch(`${window.location.origin}/api/books`, { method: "POST", body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.book_id) {
    throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
  }
  state.remoteBookId = payload.book_id;
  const url = new URL(window.location.href);
  url.searchParams.set("book_id", state.remoteBookId);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function scheduleRemoteStateSave(payload, immediate = false) {
  if (!isCloudDeployment() || !state.remoteBookId) return;
  if (state.remoteSaveTimer) window.clearTimeout(state.remoteSaveTimer);
  const bookId = state.remoteBookId;
  const save = async () => {
    state.remoteSaveTimer = null;
    try {
      const response = await fetch(`${window.location.origin}/api/books/${encodeURIComponent(bookId)}/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          book_id: bookId,
          ocr_results: payload.ocrResults,
          translation_results: payload.translationResults,
        }),
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.detail || `HTTP ${response.status}`);
      }
    } catch (error) {
      console.warn("Failed to save remote OCR state", error);
      setStatus(`本地已保存，但云端校对状态同步失败：${error.message || error}`, "warn");
    }
  };
  if (immediate) return save();
  state.remoteSaveTimer = window.setTimeout(save, 500);
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
        bboxApproximate: Boolean(line?.bboxApproximate || line?.bbox_approximate),
          reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
        regionId: line?.regionId || line?.region_id || "",
        regionLabel: line?.regionLabel || line?.region_label || "",
        error: Boolean(line?.error),
        missing: Boolean(line?.missing),
        diagnostic: Boolean(line?.diagnostic),
        index,
      })),
      regions: normalizeOcrRegions(result.regions),
      regionOrder: normalizeRegionOrder(result.regionOrder),
      layoutVersion: Number(result.layoutVersion) || 0,
      ocrProfile: OCR_PROFILES[result.ocrProfile] ? result.ocrProfile : "",
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
  // Text-layer discovery is a fallback for an empty page, never a replacement
  // for an explicit OCR or manually corrected result on that page.
  return false;
}

function discardCurrentBadPdfTextResult() {
  const existing = state.ocrResults.get(state.pageNum);
  if (existing?.source !== "pdf-text") return false;
  if (isUsablePdfDirectText(existing.text || "")) return false;
  state.ocrResults.delete(state.pageNum);
  els.ocrText.value = "";
  saveCachedResults();
  updateOcrPanelForPage();
  updateSummary();
  updateThumbnailState();
  return true;
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
      return "Gemini Vision";
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
    await renderImagePage();
    return;
  }

  if (state.sourceType === "markdown" || state.sourceType === "text" || state.sourceType === "word") {
    renderTextDocumentPage();
    return;
  }

  const token = ++state.renderToken;
  if (await renderCurrentPdfPageWithLocalService(token)) {
    syncPageControls(true);
    renderActiveSourceHighlight();
    updateOcrPanelForPage();
    updateTranslationPanelForPage();
    updateThumbnailState();
    deferCurrentPageSourceHydration(state.pageNum, token);
    return;
  }

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
  deferCurrentPageSourceHydration(state.pageNum, token);
}

function deferCurrentPageSourceHydration(pageNum, renderToken = state.renderToken) {
  scheduleIdleWork(() => hydrateCurrentPageSourceCoordinates().then(() => {
    if (pageNum !== state.pageNum || renderToken !== state.renderToken) return;
    renderActiveSourceHighlight();
    updateOcrPanelForPage();
  }));
}

async function renderCurrentPdfPageWithLocalService(token) {
  if (!state.pdfFile) return false;
  try {
    const blob = await getRenderedPdfPageBlobWithCache(state.pageNum, 180);
    if (token !== state.renderToken) return true;
    const cacheKey = makePdfPageRenderCacheKey(state.pageNum, 180);
    const cached = state.pdfPageRenderCache.get(cacheKey);
    state.pdfPageRenderUrl = cached?.url || URL.createObjectURL(blob);
    if (cached && !cached.url) {
      cached.url = state.pdfPageRenderUrl;
    }
    els.imagePage.onload = null;
    els.imagePage.onerror = null;
    els.imagePage.src = state.pdfPageRenderUrl;
    if (typeof els.imagePage.decode === "function") {
      await els.imagePage.decode().catch(() => {});
      if (token !== state.renderToken) return true;
    }
    els.imagePage.style.display = "block";
    els.pdfCanvas.style.display = "none";
    els.emptyState.style.display = "none";
    applySourcePageZoom();
    return true;
  } catch (error) {
    console.warn("Local Poppler PDF render unavailable, falling back to PDF.js", error);
    return false;
  }
}

function makePdfPageRenderCacheKey(pageNum, dpi) {
  return `${state.sourceName}:${state.sourceSize}:${pageNum}:${dpi}`;
}

async function getRenderedPdfPageBlobWithCache(pageNum, dpi) {
  if ((state.batchOcr?.running || getSelectedOcrProfile().id === "traditional") && state.pdfDoc) {
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    dpi = getBatchPdfRenderDpi(viewport.width, viewport.height, dpi);
  }
  const cacheKey = makePdfPageRenderCacheKey(pageNum, dpi);
  const cached = state.pdfPageRenderCache.get(cacheKey);
  if (cached?.blob) return cached.blob;
  if (cached?.pending) return cached.pending;
  const pending = renderPdfPageBlobWithLocalService(pageNum, dpi);
  state.pdfPageRenderCache.set(cacheKey, { pending, url: "" });
  try {
    const blob = await pending;
    state.pdfPageRenderCache.set(cacheKey, { blob, url: "" });
    return blob;
  } catch (error) {
    state.pdfPageRenderCache.delete(cacheKey);
    throw error;
  }
}

function getBatchPdfRenderDpi(width, height, requestedDpi) {
  // Oversized scan page metadata must not inflate the OCR input to 14k pixels.
  // For ordinary PDF pages, retain the user's requested resolution.
  return Math.min(requestedDpi, Math.max(72, Math.floor(4200 * 72 / Math.max(width, height, 1))));
}

async function renderPdfPageBlobWithLocalService(pageNum, dpi) {
  const formData = new FormData();
  formData.append("file", state.pdfFile, state.pdfFile.name || "source.pdf");
  formData.append("page", String(pageNum));
  formData.append("dpi", String(dpi));
  const response = await fetch(`${window.location.origin}/api/render-pdf-page`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return response.blob();
}

async function renderImagePage() {
  els.pdfCanvas.style.display = "none";
  els.imagePage.style.display = "block";
  els.emptyState.style.display = "none";
  applySourcePageZoom();
  syncPageControls(true);
  renderActiveSourceHighlight();
  updateOcrPanelForPage();
  updateTranslationPanelForPage();
  updateThumbnailState();
  deferCurrentPageSourceHydration(state.pageNum);
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

async function goToPage(pageNum, options = {}) {
  if (state.batchOcr?.running && !options.batch) return;
  if (!state.pageCount) return;
  const nextPage = clamp(Math.trunc(pageNum), 1, state.pageCount);
  if (nextPage === state.pageNum) {
    syncPageControls(true);
    return;
  }
  state.pageNum = nextPage;
  clearSourceLineHighlight();
  await renderCurrentPage();
  scheduleIdleWork(() => primeCurrentPageDirectText("page"));
  refreshControls();
}

async function syncPageInputBeforeAction() {
  const typedPage = Number(els.pageInput.value);
  if (Number.isFinite(typedPage) && Math.trunc(typedPage) !== state.pageNum) {
    await goToPage(typedPage);
  }
}

async function runOcrForCurrentPage(options = {}) {
  if (state.isOcrBusy && !options.skipBusy) return;
  if (!state.pageCount) {
    setStatus("请先上传 PDF 或图片。", "warn");
    return;
  }

  if (!options.skipPageSync) {
    await syncPageInputBeforeAction();
  }

  discardCurrentBadPdfTextResult();

  const mode = options.mode || getOcrMode();
  const profile = getSelectedOcrProfile();
  const endpoint = mode === "ai" ? els.aiOcrEndpointInput.value.trim() : els.endpointInput.value.trim();
  const engineLabel = mode === "ai" ? "Gemini Vision" : `BDRC ${profile.model}`;
  if (!endpoint) {
    setStatus(`请填写 ${mode === "ai" ? "Gemini Vision" : "BDRC"} OCR 接口地址。`, "warn");
    return;
  }

  try {
    if (!options.skipBusy) {
      setBusy(true);
    }
    setStatus(`正在生成第 ${state.pageNum} 页 OCR 图片...`, "warn");
    const blob = await getCurrentPageImageBlob();

    if (mode === "ai" && profile.id === "traditional") {
      await runTraditionalGeminiLines(endpoint, blob);
      return;
    }

    setStatus(`正在调用 ${engineLabel} OCR 接口...`, "warn");
    const parsed = await callOcrEndpoint(endpoint, blob, {
      engine: mode === "ai" ? "ai_vision" : "bdrc",
      mode: profile.id,
      ocr_profile: profile.id,
      bdrc_model: profile.model,
      bdrc_line_mode: profile.lineMode,
      prompt: mode === "ai" ? buildAiOcrPrompt("", profile.id) : "",
    });
    saveOcrResultFromParsed(
      parsed,
      mode === "ai" ? "ai-vision" : "bdrc",
      `第 ${state.pageNum} 页 ${engineLabel} 识别完成。${parsed.raw?.failed_line_count ? ` ${parsed.raw.failed_line_count} 行失败或未返回文字，请逐行重新识别。` : ""}`,
      [], parsed.raw?.line_ocr ? "proofread" : "lines"
    );
    if (mode !== "ai") {
      const reviewPage = state.pageNum;
      const reviewSourceKey = state.cacheKey;
      const lines = state.ocrResults.get(state.pageNum)?.lines || [];
      for (const [index, line] of lines.entries()) {
        if (state.pageNum !== reviewPage || state.cacheKey !== reviewSourceKey) break;
        if (isMissingOcrTranscription(line) && normalizeBbox(line.bbox)) {
          await reviewOcrLineWithAiVision(index, null, line, line, null);
        }
      }
    }
  } catch (error) {
    setStatus(
      `${engineLabel} OCR 调用失败：${formatNetworkError(error, endpoint, mode === "ai" ? "ai-ocr" : "bdrc-ocr")}`,
      "error"
    );
    throw error;
  } finally {
    if (!options.skipBusy) {
      setBusy(false);
    }
  }
}

async function runTraditionalGeminiLines(endpoint, blob) {
  const pageNum = state.pageNum;
  const sourceKey = state.cacheKey;
  const previous = getOcrSourceCompare(state.ocrResults.get(pageNum));
  setStatus("正在定位三栏并生成单行裁剪预览…", "warn");
  const layout = await callOcrEndpoint(endpoint.replace(/\/ocr\/?$/, "/line-layout"), blob);
  const lines = getParsedOcrLines(layout);
  if (!lines.length) throw new Error("未检测到可识别的文字行");
  if (state.pageNum !== pageNum || state.cacheKey !== sourceKey) throw new Error("页面已切换，请返回原页重试。");
  const oldLines = previous?.bdrc?.lines || [];
  const aligned = oldLines.length === lines.length && oldLines.every((line, index) => {
    const a = normalizeBbox(line.bbox), b = normalizeBbox(lines[index].bbox);
    return a && b && line.regionId === lines[index].regionId && a.y <= b.y + b.height && b.y <= a.y + a.height;
  });
  if (previous) layout.raw.previous_compare = previous;
  layout.compare = {
    ...(aligned ? previous : {}),
    bdrc: aligned ? { ...previous.bdrc, lines: oldLines.map((line, index) => ({
      ...line, bbox: lines[index].bbox, bboxApproximate: false, regionLineCount: 1,
    })) } : { label: "BDRC", text: "", lines: [] },
    llm: { label: "Gemini Vision", text: getParsedOcrText(layout), lines, provider: "gemini" },
  };
  saveOcrResultFromParsed(layout, "ai-vision", "裁剪预览已生成，正在逐行识别…", [], "proofread");
  const result = state.ocrResults.get(pageNum);
  for (let index = 0; index < lines.length; index += 1) {
    if (state.pageNum !== pageNum || state.cacheKey !== sourceKey) throw new Error("页面已切换，已完成的行已保存。");
    const line = lines[index];
    setStatus(`正在识别第 ${index + 1} / ${lines.length} 个文字行…`, "warn");
    try {
      const parsed = await callAiVisionLineReviewEndpoint(
        endpoint.replace(/\/ocr\/?$/, "/line-review"), blob, line.bbox, "", "", line.reviewImage, line.regionId, true,
      );
      if (state.pageNum !== pageNum || state.cacheKey !== sourceKey) throw new Error("页面已切换");
      const text = getParsedOcrText(parsed);
      if (!text) throw new Error("模型未返回文字");
      Object.assign(line, { text, error: false, missing: false, reviewImage: parsed.raw?.review_image || line.reviewImage,
        model: getOcrResponseModel(parsed.raw), provider: "gemini" });
    } catch (error) {
      if (state.pageNum !== pageNum || state.cacheKey !== sourceKey) throw error;
      Object.assign(line, { text: "〔本行识别失败，待重新识别〕", error: true, missing: true });
      line.recognitionError = formatNetworkError(error, endpoint, "ai-ocr");
    }
    result.lines[index] = { ...line };
    result.compare.llm.lines[index] = { ...line };
    result.compare.llm.text = result.compare.llm.lines.map((item) => item.text || "").join("\n");
    result.text = result.lines.map((item) => item.text || "").join("\n");
    result.raw.failed_line_count = result.lines.filter((item) => item.error || item.missing).length;
    result.updatedAt = new Date().toISOString();
    state.ocrResults.set(pageNum, result);
    await saveCachedResults({ immediateRemote: true });
    updateOcrPanelForPage();
    updateSummary();
  }
  const failed = result.raw.failed_line_count;
  setStatus(`第 ${pageNum} 页逐行识别完成：${lines.length - failed} 行成功，${failed} 行失败。`, failed ? "warn" : "ok");
}

function hasValidPageOcr(result) {
  if (Number(result?.raw?.failed_line_count) > 0) return false;
  if (!String(result?.text || "").trim()) return false;
  if (isDirectTextSource(result.source)) return true;
  const lines = getExistingResultLines(result);
  return lines.some((line) => !line.error && !line.diagnostic && !isMissingOcrTranscription(line)
    && /[\u0f00-\u0fff0-9]/.test(String(line.text || "")));
}

function updateBatchOcrProgress() {
  if (!els.batchOcrProgress) return;
  const progressKey = state.cacheKey ? `tibetan-ocr-batch:${state.cacheKey}` : "";
  if (!state.batchOcr && progressKey) {
    try {
      const saved = JSON.parse(window.localStorage.getItem(progressKey) || "null");
      if (saved?.total === state.pageCount && Array.isArray(saved.pages)
        && Array.isArray(saved.success) && Array.isArray(saved.failed)) {
        state.batchOcr = { ...saved, running: false, cancelled: saved.cancelled || saved.running };
      }
    } catch (error) { console.warn("Failed to restore batch progress", error); }
  }
  const job = state.batchOcr;
  els.cancelBatchOcrButton.hidden = !job?.running;
  els.cancelBatchOcrButton.disabled = Boolean(job?.cancelled);
  els.batchOcrButton.disabled = !state.pageCount || state.isOcrBusy || state.activeProjectRestoreInFlight || state.sourceType !== "pdf";
  if (!job) {
    els.batchOcrProgress.textContent = "";
    return;
  }
  const remaining = job.pages.length - job.success.length - job.failed.length;
  const label = job.running ? (job.cancelled ? "正在停止，等待当前页保存" : `正在处理第 ${job.currentPage} 页`)
    : job.cancelled ? "批量已停止" : "批量已结束";
  els.batchOcrProgress.textContent = `${label} · 共 ${job.total} 页 · 已有 ${job.skipped} 页 · 本次成功 ${job.success.length} 页 · 失败 ${job.failed.length} 页 · 剩余 ${remaining} 页${job.failed.length ? `；失败页：${job.failed.map((item) => item.page).join("、")}` : ""}`;
  els.batchOcrProgress.title = job.failed.map((item) => `第 ${item.page} 页：${item.error}`).join("\n");
  if (progressKey) {
    try { window.localStorage.setItem(progressKey, JSON.stringify(job)); }
    catch (error) { console.warn("Failed to save batch progress", error); }
  }
}

async function runOcrForRemainingPages() {
  if (state.isOcrBusy || state.activeProjectRestoreInFlight || state.sourceType !== "pdf" || !state.pageCount) return;
  const originalPage = state.pageNum;
  const sourceKey = state.cacheKey;
  const pages = Array.from({ length: state.pageCount }, (_, index) => index + 1)
    .filter((page) => !hasValidPageOcr(state.ocrResults.get(page)));
  const job = { running: true, cancelled: false, currentPage: 0, total: state.pageCount,
    pages, skipped: state.pageCount - pages.length, success: [], failed: [] };
  state.batchOcr = job;
  setBusy(true);
  refreshControls();
  try {
    for (const page of pages) {
      if (job.cancelled || sourceKey !== state.cacheKey) { job.cancelled = true; break; }
      job.currentPage = page;
      updateBatchOcrProgress();
      try {
        await goToPage(page, { batch: true });
        await runOcrForCurrentPage({ skipBusy: true, skipPageSync: true, mode: getOcrMode() });
        if (!hasValidPageOcr(state.ocrResults.get(page))) throw new Error("未返回有效 OCR 文字");
        await saveCachedResults({ immediateRemote: true });
        job.success.push(page);
      } catch (error) {
        job.failed.push({ page, error: String(error.message || error) });
      }
      updateBatchOcrProgress();
    }
  } finally {
    job.running = false;
    setBusy(false);
    try {
      if (sourceKey === state.cacheKey) await goToPage(originalPage, { batch: true });
    } catch (error) {
      setStatus(`结果已保存，但原页面恢复失败：${error.message || error}`, "warn");
    }
    refreshControls();
    updateBatchOcrProgress();
    setStatus(`批量${job.cancelled ? "已停止" : "完成"}：成功 ${job.success.length} 页，失败 ${job.failed.length} 页。已完成结果已保存。`, job.failed.length ? "warn" : "ok");
  }
}

function getOcrMode() {
  return els.ocrModeSelect?.value === "ai" ? "ai" : "bdrc";
}

function getSelectedOcrProfile() {
  const id = els.ocrProfileSelect?.value || state.ocrProfile || DEFAULT_OCR_PROFILE;
  const profile = OCR_PROFILES[id] || OCR_PROFILES[DEFAULT_OCR_PROFILE];
  return { id: OCR_PROFILES[id] ? id : DEFAULT_OCR_PROFILE, ...profile };
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

  const response = await fetchOcrWithTransientRetry(endpoint, formData, fields.engine === "ai_vision");
  const parsed = await parseOcrResponse(response);
  if (!response.ok) {
    throw new Error(parsed.error || `HTTP ${response.status}`);
  }
  if (fields.engine === "ai_vision") {
    assertSupportedAiVisionResponse(parsed);
  }
  return parsed;
}

async function fetchOcrWithTransientRetry(endpoint, formData, retryTransient) {
  const maxRetries = retryTransient ? 3 : 0;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(endpoint, { method: "POST", body: formData });
      if (retryTransient && [502, 503, 504].includes(response.status) && attempt < maxRetries) {
        await waitForOcrRetry(attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!retryTransient || !isTransientOcrNetworkError(error) || attempt >= maxRetries) {
        throw error;
      }
      await waitForOcrRetry(attempt);
    }
  }

  throw lastError || new Error("OCR 请求失败");
}

function isTransientOcrNetworkError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("failed to fetch")
    || message.includes("networkerror")
    || message.includes("network error")
    || message.includes("econnrefused")
    || message.includes("connection reset");
}

function waitForOcrRetry(attempt) {
  const delay = Math.min(3200, 800 * (2 ** attempt));
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}

function getExistingResultLines(result) {
  if (Array.isArray(result?.lines) && result.lines.length) return result.lines;
  return makeOcrLinesFromText(result?.text || "");
}

function needsSourceCoordinateHydration(result) {
  const lines = getExistingResultLines(result);
  return lines.length > 0 && lines.some((line) => !normalizeBbox(line?.bbox));
}

function getAiVisionLayoutEndpoint() {
  const endpoint = els.aiOcrEndpointInput.value.trim();
  return endpoint.replace(/\/ocr\/?$/, "/layout");
}

function getAiVisionLineReviewEndpoint() {
  const endpoint = els.aiOcrEndpointInput.value.trim();
  return endpoint.replace(/\/ocr\/?$/, "/line-review");
}

async function callAiVisionLineReviewEndpoint(endpoint, blob, bbox, draftText = "", model = "", reviewImage = null, regionId = "", primaryLine = false) {
  const formData = new FormData();
  formData.append("file", blob, makePageImageName());
  formData.append("lang", "bo");
  formData.append("page", String(state.pageNum));
  formData.append("source_name", state.sourceName);
  formData.append("bbox", JSON.stringify(bbox));
  formData.append("ocr_text", String(draftText || ""));
  if (reviewImage) formData.append("review_image", JSON.stringify(reviewImage));
  if (regionId) formData.append("region_id", regionId);
  if (primaryLine) formData.append("primary_line", "1");
  if (model) formData.append("model", model);

  const response = await fetchOcrWithTransientRetry(endpoint, formData, true);
  const parsed = await parseOcrResponse(response);
  if (!response.ok) {
    throw new Error(parsed.error || `HTTP ${response.status}`);
  }
  assertSupportedAiVisionResponse(parsed);
  return parsed;
}

function mergeSourceCoordinates(lines, layoutLines) {
  return lines.map((line, index) => {
    const layoutLine = layoutLines[index] || {};
    return {
      ...line,
      bbox: normalizeBbox(line?.bbox) || normalizeBbox(layoutLine?.bbox),
      bboxApproximate: Boolean(
        line?.bboxApproximate ||
        line?.bbox_approximate ||
        layoutLine?.bboxApproximate ||
        layoutLine?.bbox_approximate
      ),
      index,
    };
  });
}

async function hydrateCurrentPageSourceCoordinates() {
  const result = state.ocrResults.get(state.pageNum);
  if (!needsSourceCoordinateHydration(result)) return;

  const pageNum = state.pageNum;
  if (state.layoutHydrationInFlight.has(pageNum)) {
    await state.layoutHydrationInFlight.get(pageNum);
    return;
  }

  const task = (async () => {
    const existingLines = getExistingResultLines(result);
    const endpoint = getAiVisionLayoutEndpoint();
    if (!endpoint) return;

    try {
      const blob = await getCurrentPageImageBlob();
      const formData = new FormData();
      formData.append("file", blob, makePageImageName());
      formData.append("line_count", String(existingLines.length));
      formData.append("ocr_profile", getSelectedOcrProfile().id);
      const response = await fetch(endpoint, { method: "POST", body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const layoutLines = extractOcrLines(payload);
      if (!layoutLines.length || pageNum !== state.pageNum) return;

      const updated = state.ocrResults.get(pageNum);
      if (!updated) return;
      updated.lines = mergeSourceCoordinates(getExistingResultLines(updated), layoutLines);
      if (updated.compare?.llm?.lines?.length) {
        updated.compare.llm.lines = mergeSourceCoordinates(updated.compare.llm.lines, layoutLines);
      }
      updated.layoutVersion = SOURCE_LAYOUT_VERSION;
      updated.updatedAt = new Date().toISOString();
      state.ocrResults.set(pageNum, updated);
      saveCachedResults();
    } catch (error) {
      console.warn("Failed to hydrate source preview coordinates", error);
    }
  })();

  state.layoutHydrationInFlight.set(pageNum, task);
  try {
    await task;
  } finally {
    state.layoutHydrationInFlight.delete(pageNum);
  }
}

function assertSupportedAiVisionResponse(parsed) {
  const model = getOcrResponseModel(parsed?.raw).toLowerCase();
  const provider = getOcrResponseProvider(parsed?.raw).toLowerCase();
  if (provider === "mathpix" || model.includes("mathpix")) {
    throw new Error(
      "Gemini Vision 已拒绝 Mathpix 结果：Mathpix 主要用于数学公式，不适合作为藏文 OCR 模型。请使用 Gemini 重新识别。"
    );
  }
}

function saveOcrResultFromParsed(parsed, source, statusMessage, fallbackLines = [], preferredView = "lines") {
  const text = getParsedOcrText(parsed);
  const rawLines = getParsedOcrLines(parsed);
  const lines = rawLines.length ? rawLines : makeOcrLinesFromText(text, fallbackLines);
  const recognizedAt = new Date().toISOString();
  const compare = normalizeOcrCompare(parsed.compare);
  if (compare?.llm && !compare.llm.recognizedAt) {
    compare.llm.recognizedAt = recognizedAt;
  }
  state.ocrResults.set(state.pageNum, {
    text,
    raw: parsed.raw,
    compare,
    lines,
    regions: normalizeOcrRegions(parsed.regions || parsed.raw?.regions),
    regionOrder: normalizeRegionOrder(parsed.region_order || parsed.regionOrder),
    layoutVersion: SOURCE_LAYOUT_VERSION,
    ocrProfile: getSelectedOcrProfile().id,
    source,
    updatedAt: recognizedAt,
  });
  seedChatGptDialogOpenAiReview(state.pageNum, state.ocrResults.get(state.pageNum));
  saveCachedResults();
  els.ocrText.value = text;
  setOcrView(preferredView === "proofread" ? "proofread" : preferredView === "compare" && compare ? "compare" : "lines");
  const statusType = statusMessage.includes("失败") || statusMessage.includes("未填写") ? "warn" : "ok";
  setStatus(statusMessage, statusType);
  updateOcrPanelForPage();
  updateSummary();
  updateThumbnailState();
}

function saveSmartOcrCompareResult({ bdrcParsed, aiParsed = null, aiError = "", bdrcError = "", aiPending = false, statusMessage, statusType = "ok" }) {
  const bdrcText = getParsedOcrText(bdrcParsed);
  const bdrcRawLines = getParsedOcrLines(bdrcParsed);
  const bdrcLines = bdrcRawLines.length
    ? bdrcRawLines
    : bdrcError
      ? [{
          text: `BDRC 当前不可用：${bdrcError}`,
          bbox: null,
          index: 0,
          error: true,
        }]
      : makeOcrLinesFromText(bdrcText);
  const aiText = getParsedOcrText(aiParsed);
  const aiRawLines = getParsedOcrLines(aiParsed);
  const aiModel = getOcrResponseModel(aiParsed?.raw);
  const aiProvider = getOcrResponseProvider(aiParsed?.raw);
  const hasAiContent = Boolean(aiText || aiRawLines.some((line) => String(line?.text || "").trim()));
  const aiLines = hasAiContent
    ? (aiRawLines.length ? aiRawLines : makeOcrLinesFromText(aiText))
    : aiPending
      ? [{
          text: "Gemini Vision 正在识别...",
          bbox: null,
          index: 0,
          diagnostic: true,
          pending: true,
        }]
    : [{
        text: aiError || "Gemini Vision 未返回文本。",
        bbox: null,
        index: 0,
        error: true,
      }];
  const result = {
    raw: {
      source: "smart",
      bdrc: bdrcParsed.raw,
      bdrc_error: bdrcError || "",
      ai: aiParsed?.raw || null,
      ai_error: aiError || "",
    },
    text: aiText || bdrcText,
    compare: {
      note: bdrcError
        ? "BDRC 初稿不可用，已在左栏显示原因；右栏为 Gemini Vision 识别结果。"
        : aiError
        ? "右栏 Gemini Vision / LLM 未返回可用文本，已显示失败原因；左栏 BDRC 初稿仍可继续人工校对。"
        : "左栏为 BDRC OCR 初稿，右栏为 Gemini Vision / LLM 识别或复核结果。",
      bdrc: {
        label: "BDRC",
        text: bdrcText,
        lines: bdrcLines,
        error: Boolean(bdrcError),
      },
      llm: {
        label: "Gemini Vision / LLM",
        text: aiText,
        lines: aiLines,
        error: Boolean(aiError),
        pending: aiPending,
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
  const lines = Array.isArray(parsed?.lines) ? parsed.lines : parsed?.raw ? extractOcrLines(parsed.raw) : [];
  return lines.map((line) => ({
        ...line,
        text: normalizeOcrTextSpacing(line?.text || ""),
      }));
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
  return {
    note: String(compare.note || ""),
    bdrc,
    llm,
    openaiReviews: Array.isArray(compare.openaiReviews) ? compare.openaiReviews.filter((review) => Number.isInteger(review?.index) && typeof review?.text === "string") : [],
    qwenReviews: Array.isArray(compare.qwenReviews) ? compare.qwenReviews.filter((review) => Number.isInteger(review?.index) && typeof review?.text === "string") : [],
    sharedErrors: normalizeSharedErrorMarks(compare.sharedErrors || compare.commonErrors || compare.sharedErrorMarks),
  };
}

const CHATGPT_DIALOG_OPENAI_REVIEW = {
  index: 2,
  text: "སྤྲུལ་སྐུ་ཉིད་ཀྱིས་མཛད།",
  model: "ChatGPT 对话复核",
  provider: "openai",
  note: "其中 ཉིད 暂作疑字，仍需人工确认。",
};

function seedChatGptDialogOpenAiReview(pageNum, result) {
  if (pageNum !== 1 || !/2②⅝⑦5⑦=3=51\.pdf/.test(String(state.sourceName || ""))) return false;
  const compare = result?.compare;
  if (!compare || !Array.isArray(compare.openaiReviews)) return false;
  if (compare.openaiReviews.some((review) => review.index === CHATGPT_DIALOG_OPENAI_REVIEW.index)) return false;
  const sourceLine = compare.bdrc?.lines?.[CHATGPT_DIALOG_OPENAI_REVIEW.index]
    || compare.llm?.lines?.[CHATGPT_DIALOG_OPENAI_REVIEW.index];
  compare.openaiReviews.push({
    ...CHATGPT_DIALOG_OPENAI_REVIEW,
    bbox: normalizeBbox(sourceLine?.bbox),
    reviewedAt: new Date().toISOString(),
  });
  return true;
}

function normalizeSharedErrorMarks(marks) {
  if (!Array.isArray(marks)) return [];
  return marks
    .map((mark, index) => {
      if (!mark || typeof mark !== "object") return null;
      const blockIndex = Number(mark.blockIndex ?? mark.rowIndex ?? mark.index);
      if (!Number.isInteger(blockIndex) || blockIndex < 0) return null;
      const normalized = {
        id: String(mark.id || `shared-error-${blockIndex}-${index}`),
        blockIndex,
        text: String(mark.text || ""),
        bdrcRanges: normalizeTextRanges(mark.bdrcRanges || mark.bdrc || mark.leftRanges),
        llmRanges: normalizeTextRanges(mark.llmRanges || mark.aiRanges || mark.ai || mark.rightRanges),
        model: String(mark.model || mark.llmModel || ""),
        provider: String(mark.provider || mark.llmProvider || ""),
        requestId: String(mark.requestId || mark.request_id || ""),
        ocrRunAt: String(mark.ocrRunAt || mark.recognizedAt || ""),
        createdAt: String(mark.createdAt || ""),
      };
      return normalized.bdrcRanges.length || normalized.llmRanges.length ? normalized : null;
    })
    .filter(Boolean);
}

function normalizeTextRanges(ranges) {
  if (!Array.isArray(ranges)) return [];
  return mergeRanges(ranges.map((range) => ({
    start: Number(range?.start),
    end: Number(range?.end),
  })));
}

function normalizeOcrQualityReviews(reviews) {
  if (!Array.isArray(reviews)) return [];
  return reviews
    .map((review, index) => {
      if (!review || typeof review !== "object") return null;
      const pageNum = Number(review.pageNum);
      const blockIndex = Number(review.blockIndex);
      const reviewedChars = Number(review.reviewedChars);
      const errorChars = Number(review.errorChars);
      if (!Number.isInteger(pageNum) || pageNum < 1 || !Number.isInteger(blockIndex) || blockIndex < 0) return null;
      if (!Number.isFinite(reviewedChars) || reviewedChars < 0 || !Number.isFinite(errorChars) || errorChars < 0) return null;
      return {
        id: String(review.id || `quality-review-${pageNum}-${blockIndex}-${index}`),
        pageNum,
        blockIndex,
        model: String(review.model || "未知模型"),
        provider: String(review.provider || ""),
        requestId: String(review.requestId || review.request_id || ""),
        ocrRunAt: String(review.ocrRunAt || ""),
        reviewedAt: String(review.reviewedAt || ""),
        reviewedChars: Math.round(reviewedChars),
        errorChars: Math.min(Math.round(errorChars), Math.round(reviewedChars)),
      };
    })
    .filter(Boolean);
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
          bboxApproximate: Boolean(line?.bboxApproximate || line?.bbox_approximate),
          reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
          regionId: line?.regionId || line?.region_id || line?.id || "",
          regionLabel: line?.regionLabel || line?.region_label || line?.label || "",
          regionRole: line?.regionRole || line?.region_role || line?.role || "",
          regionDirection: line?.regionDirection || line?.region_direction || line?.direction || "",
          regionLineCount: Number(line?.regionLineCount || line?.region_line_count || line?.line_count || line?.lineCount || line?.lines?.length || 0) || 0,
          index,
          error: Boolean(line?.error),
          missing: Boolean(line?.missing),
          diagnostic: Boolean(line?.diagnostic),
          model: String(line?.model || ""),
          provider: String(line?.provider || ""),
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
    regions: normalizeOcrRegions(side.regions),
    regionOrder: normalizeRegionOrder(side.region_order || side.regionOrder),
    error: Boolean(side.error),
    pending: Boolean(side.pending || side.isPending),
    model: String(side.model || ""),
    provider: String(side.provider || ""),
    recognizedAt: String(side.recognizedAt || side.ocrRunAt || ""),
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

function buildAiOcrPrompt(bdrcText, profileId = state.ocrProfile) {
  const profile = OCR_PROFILES[profileId] || OCR_PROFILES[DEFAULT_OCR_PROFILE];
  const bdrcLineCount = countTextLines(bdrcText);
  return [
    `请识别图片中的藏文文字。资料类型：${profile.label}。`,
    profile.prompt,
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
    if (!isUsablePdfDirectText(existingText)) {
      state.ocrResults.delete(state.pageNum);
      saveCachedResults();
      if (updatePanel) {
        els.ocrText.value = "";
        updateOcrPanelForPage();
        updateSummary();
        updateThumbnailState();
      }
    } else {
      return {
        text: existingText,
        source: "pdf-text",
        label: getResultSourceLabel(existing),
        persisted: false,
        fromExisting: true,
      };
    }
  }

  if (!overwrite && existing?.source === "pdf-text" && existingText && isUsablePdfDirectText(existingText)) {
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

  if (!isUsablePdfDirectText(pdfTextResult.text)) {
    if (existing?.source === "pdf-text") {
      state.ocrResults.delete(state.pageNum);
      saveCachedResults();
      if (updatePanel) {
        els.ocrText.value = "";
        updateOcrPanelForPage();
        updateSummary();
        updateThumbnailState();
      }
    }
    return {
      text: "",
      source: "pdf-text",
      label: "PDF 文本层",
      persisted: false,
      rejected: true,
      reason: "PDF 文本层疑似字体编码乱码",
    };
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

function isUsablePdfDirectText(text) {
  const value = String(text || "").trim();
  if (!value) return false;

  const visibleChars = [...value].filter((char) => !/\s/.test(char));
  if (visibleChars.length < 12) return false;

  const tibetanCount = visibleChars.filter((char) => /[\u0F00-\u0FFF]/u.test(char)).length;
  const cjkCount = visibleChars.filter((char) => /[\u3400-\u9FFF]/u.test(char)).length;
  const latinExtendedCount = visibleChars.filter((char) => /[\u00C0-\u024F]/u.test(char)).length;
  const replacementCount = visibleChars.filter((char) => char === "\uFFFD").length;
  const controlCount = visibleChars.filter((char) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(char)).length;
  const readableScriptCount = tibetanCount + cjkCount;
  const suspiciousCount = latinExtendedCount + replacementCount + controlCount;
  const tibetanRatio = tibetanCount / visibleChars.length;
  const cjkRatio = cjkCount / visibleChars.length;
  const latinExtendedRatio = latinExtendedCount / visibleChars.length;
  const suspiciousRatio = suspiciousCount / visibleChars.length;

  if (tibetanCount >= 8) {
    if (latinExtendedCount >= 4 && latinExtendedRatio >= 0.04) {
      return false;
    }
    return tibetanRatio >= 0.65 && suspiciousRatio < 0.08;
  }

  if (latinExtendedCount >= 4 && latinExtendedCount > tibetanCount + cjkCount) {
    return false;
  }

  if (cjkCount >= 10 && cjkRatio >= 0.5 && suspiciousRatio < 0.08) {
    return true;
  }

  if (suspiciousCount >= 5 && suspiciousCount > readableScriptCount) {
    return false;
  }

  const plainLatinCount = visibleChars.filter((char) => /[A-Za-z0-9.,;:!?'"()[\]{}\-_/]/.test(char)).length;
  return plainLatinCount >= 20 && suspiciousCount / visibleChars.length < 0.08;
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
  const regionLines = flattenTraditionalRegionLines(payload.regions);
  if (regionLines.length) return regionLines;
  const candidates = payload.regions || payload.lines || payload.blocks || payload.items;
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
        bboxApproximate: Boolean(line?.bbox_approximate || line?.bboxApproximate),
        reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
        regionId: line?.region_id || line?.regionId || line?.id || "",
        regionLabel: line?.region_label || line?.regionLabel || line?.label || "",
        regionRole: line?.region_role || line?.regionRole || line?.role || "",
        regionDirection: line?.region_direction || line?.regionDirection || line?.direction || "",
        regionLineCount: Number(line?.line_count ?? line?.lineCount ?? line?.lines?.length ?? 0) || 0,
        index,
        error: Boolean(line?.error),
        missing: Boolean(line?.missing),
        diagnostic: Boolean(line?.diagnostic),
      };
    })
    .filter((line) => line.text || line.bbox);
}

function flattenTraditionalRegionLines(regions) {
  if (!Array.isArray(regions) || !regions.length) return [];
  const normalizedRegions = normalizeOcrRegions(regions);
  const output = [];

  normalizedRegions.forEach((region) => {
    const sourceLines = region.lines?.length
      ? region.lines
      : String(region.text || "")
        .split(/\r?\n/)
        .map((text) => ({ text, bbox: region.bbox, bboxApproximate: true }));

    sourceLines.forEach((line, regionLineIndex) => {
      const text = normalizeOcrTextSpacing(String(line?.text || "").trim());
      if (!text) return;
      output.push({
        text,
        bbox: normalizeBbox(line?.bbox) || region.bbox,
        bboxApproximate: Boolean(line?.bboxApproximate || line?.bbox_approximate),
          reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
        regionId: region.id,
        regionLabel: region.label,
        regionRole: region.role,
        regionDirection: region.direction,
        regionLineCount: region.lineCount || sourceLines.length,
        regionLineIndex,
        index: output.length,
      });
    });
  });

  return output;
}

function formatOcrLineDisplayNumber(line, index) {
  const regionPrefix = {
    左侧: "左",
    中间: "中",
    右侧: "右",
  }[line?.regionLabel];
  if (regionPrefix) {
    return `${regionPrefix}${String(Number(line.regionLineIndex || 0) + 1).padStart(2, "0")}`;
  }
  return String(index + 1).padStart(2, "0");
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

function normalizeOcrRegions(regions) {
  if (!Array.isArray(regions)) return [];
  const canonicalRegions = CANONICAL_REGION_ORDER.map((id, index) => {
    const region = regions.find((candidate, candidateIndex) => normalizeRegionId(candidate, candidateIndex) === id);
    return { ...(region || {}), id, __canonicalIndex: index };
  });
  const sourceRegions = regions.some((region, index) => {
    const id = normalizeRegionId(region, index);
    return CANONICAL_REGION_ORDER.includes(id);
  }) ? canonicalRegions : regions;
  return sourceRegions.map((region, index) => {
    const regionId = normalizeRegionId(region, index);
    const defaults = CANONICAL_REGION_DEFAULTS[regionId] || {};
    const bbox = normalizeBbox(region?.bbox || region);
    const lines = Array.isArray(region?.lines)
      ? region.lines.map((line, lineIndex) => ({
          text: normalizeOcrTextSpacing(line?.text || line?.content || line?.value || ""),
          bbox: normalizeBbox(line?.bbox) || bbox,
          bboxApproximate: Boolean(line?.bboxApproximate || line?.bbox_approximate),
          reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
          index: lineIndex,
        })).filter((line) => line.text || line.bbox)
      : [];
    const text = normalizeOcrTextSpacing(
      String(region?.text || lines.map((line) => line.text).filter(Boolean).join("\n") || "")
    );
    return {
      id: regionId,
      label: String(region?.label || region?.region_label || defaults.label || ""),
      role: String(region?.role || region?.region_role || defaults.role || ""),
      direction: String(region?.direction || region?.region_direction || defaults.direction || ""),
      textOrientation: String(region?.text_orientation || region?.textOrientation || defaults.textOrientation || ""),
      regionType: String(region?.region_type || region?.regionType || defaults.regionType || ""),
      bbox,
      text,
      lines,
      lineCount: Number(region?.line_count ?? region?.lineCount ?? lines.length) || 0,
      empty: Boolean(region?.empty) || !text,
      error: String(region?.error || ""),
    };
  });
}

function normalizeRegionId(region, index) {
  const raw = String(region?.id || region?.region_id || region?.label || region?.region_label || "")
    .trim()
    .toLowerCase();
  const aliases = {
    left: "left",
    "左": "left",
    "左侧": "left",
    "左欄": "left",
    center: "center",
    middle: "center",
    "中": "center",
    "中间": "center",
    "中間": "center",
    "正文": "center",
    "右": "right",
    "右侧": "right",
    "右欄": "right",
    right: "right",
  };
  return aliases[raw] || (CANONICAL_REGION_ORDER[index] || String(region?.id || region?.region_id || `region-${index + 1}`));
}

function normalizeRegionOrder(order) {
  void order;
  return CANONICAL_REGION_ORDER.slice();
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

  if (state.pdfFile) {
    try {
      return await getRenderedPdfPageBlobWithCache(state.pageNum, Number(els.dpiInput.value) || 260);
    } catch (error) {
      console.warn("Local Poppler OCR render unavailable, falling back to PDF.js", error);
    }
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
    setStatus("当前页没有 Gemini Vision OCR 文本可复制。", "warn");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus("当前页 Gemini Vision OCR 文本已复制。", "ok");
  } catch {
    setStatus("浏览器剪贴板不可用，请在 Gemini Vision 栏手动选择复制。", "warn");
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
  els.ocrPaneEyebrow.textContent = showProofread ? "OCR 校对结果" : "OCR 识别结果";
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
  const { side, peer, key } = getPrimaryOcrDisplay(compare);
  renderOcrSourceSide(els.ocrLineCompare, side, peer, key, compare);
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
    const { side, peer, key } = getPrimaryOcrDisplay(sourceCompare);
    renderOcrSourceSide(els.ocrLineCompare, side, peer, key, sourceCompare);
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
    rowHeader.textContent = formatOcrLineDisplayNumber(line, index);
    if (line?.regionLabel) {
      rowHeader.title = `${line.regionLabel}第 ${Number(line.regionLineIndex || 0) + 1} 行`;
    }

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
    const activateLine = () => activateOcrLine(
      getSourceLineForRow(line, null),
      index,
      row,
    );
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
  const sourceCompare = getAiOnlyDisplayCompare(compare || getCurrentOcrCompareOrEmpty());
  renderOcrSourceSide(els.aiOcrLineCompare, sourceCompare.llm, sourceCompare.bdrc, "llm", sourceCompare);
  updateAiOcrPanelMeta(sourceCompare);
}

function renderProofreadMergedView() {
  els.ocrLineCompare.innerHTML = "";
  els.ocrLineCompare.classList.add("proofread-block-list");

  if (!state.pageCount) {
    const empty = document.createElement("div");
    empty.className = "line-compare-empty";
    empty.innerHTML = "<strong>等待加载文件</strong><span>加载 PDF 或图片后，这里会按 block 显示原文和 Gemini Vision 结果。</span>";
    els.ocrLineCompare.appendChild(empty);
    renderAiOcrPanelForPage();
    return;
  }

  const ensured = ensureProofreadCompareResult();
  const result = ensured.result;
  // The editor needs both candidates. Applying the AI-only display adapter
  // here erased the existing BDRC rows as soon as the user switched views.
  const compare = ensured.compare;
  renderAiOcrPanelForPage(compare);

  const bdrcLines = getEffectiveOcrSideLines(compare.bdrc);
  const aiLines = getEffectiveOcrSideLines(compare.llm, bdrcLines);
  const finalLines = result.lines?.length ? result.lines : makeOcrLinesFromText(result.text || "", bdrcLines);
  const rowCount = Math.max(bdrcLines.length, aiLines.length, finalLines.length);

  if (!rowCount) {
    const empty = document.createElement("div");
    empty.className = "line-compare-empty";
    empty.innerHTML = "<strong>等待识别</strong><span>点击“识别”后，每个原文 block 下方会出现可编辑的 Gemini Vision 结果。</span>";
    els.ocrLineCompare.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  Array.from({ length: rowCount }, (_, index) => {
    const bdrcLine = bdrcLines[index] || { text: "", bbox: aiLines[index]?.bbox || finalLines[index]?.bbox || null, index };
    const rawAiLine = aiLines[index] || { text: "", bbox: bdrcLine.bbox || finalLines[index]?.bbox || null, index };
    const aiLine = makeProofreadAiLine(compare, rawAiLine, index, rawAiLine.bbox || bdrcLine.bbox || finalLines[index]?.bbox || null);
    const sourceLine =
      getSourceLineForRow(bdrcLine, aiLine) ||
      getSourceLineForRow(finalLines[index], null) ||
      makeEstimatedSourceLineForRow(index, rowCount);
    fragment.appendChild(renderProofreadBlockCard({
      index,
      bdrcLine,
      aiLine,
      finalLine: finalLines[index] || null,
      sourceLine,
      compare,
    }));
  });
  els.ocrLineCompare.appendChild(fragment);
  if (window.lucide) {
    window.lucide.createIcons();
  }
  updateSourcePreviewScaleButtons();
}

function renderProofreadBlockCard({ index, bdrcLine, aiLine, finalLine, sourceLine, compare }) {
  const card = document.createElement("section");
  card.className = "proofread-block-card";
  card.dataset.proofreadBlock = String(index);
  card.dataset.sourceRowIndex = String(index);
  const regionLabel = aiLine?.regionLabel || bdrcLine?.regionLabel || finalLine?.regionLabel || "";
  if (regionLabel) {
    card.dataset.region = regionLabel;
  }
  const hasPreciseSourceLine = Boolean(sourceLine?.bbox && !sourceLine.estimated);
  card.classList.toggle("has-source-line", hasPreciseSourceLine);
  card.title = hasPreciseSourceLine
    ? `点击同步左栏第 ${index + 1} 个${regionLabel ? `${regionLabel} ` : ""}原文 block`
    : "";
  card.classList.toggle("is-active", state.activeOcrLine === index);

  const savedSide = getProofreadDefaultChoice(finalLine, bdrcLine, aiLine);

  const saveButton = document.createElement("button");
  saveButton.className = "secondary-button proofread-save-button";
  saveButton.type = "button";
  saveButton.innerHTML = '<i data-lucide="save"></i>保存';
  saveButton.addEventListener("click", () => {
    const selected =
      card.querySelector(".proofread-choice-select")?.value ||
      card.querySelector("input[type='radio']:checked")?.value ||
      getProofreadDefaultChoice(finalLine, bdrcLine, aiLine);
    saveProofreadBlockChoice(index, selected, card);
  });

  const options = document.createElement("div");
  options.className = "proofread-options proofread-block-actions";
  options.append(
    renderQwenLineReview(index, sourceLine, bdrcLine, aiLine),
    renderOpenAiLineReview(index, sourceLine, bdrcLine, aiLine),
    renderSharedErrorActionGroup(index, card),
    saveButton,
  );
  const choiceSelect = renderProofreadChoiceSelect(
    index,
    savedSide,
    aiLine.provider === "qwen" ? "千问候选" : aiLine.provider === "openai" ? "OpenAI 候选" : "Gemini Vision",
    compare,
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
      compare,
    }),
    renderProofreadEditorGroup({
      index,
      side: "llm",
      label: aiLine.provider === "qwen" ? "千问复核候选" : aiLine.provider === "openai" ? "OpenAI 复核候选" : "Gemini Vision 识别",
      line: aiLine,
      peerLine: bdrcLine,
      compare,
    }),
  );

  const reviewHeader = stack.querySelector(".proofread-editor-group.is-ai .proofread-editor-label");
  const geminiReview = renderAiVisionLineReviewButton(index, card, sourceLine, bdrcLine, aiLine);
  geminiReview.classList.add("review-in-heading");
  reviewHeader.appendChild(geminiReview);

  const activate = () => {
    if (!hasPreciseSourceLine) return;
    const line = sourceLine || getSourceLineForRow(bdrcLine, aiLine);
    activateOcrSourceBlock(line, index, { scrollRows: false });
  };
  card.addEventListener("click", (event) => {
    if (event.target.closest("button, textarea, input, label, select")) return;
    activate();
  });

  const sourcePanel = renderProofreadSourcePanel(sourceLine, index);
  options.append(choiceSelect);
  card.append(sourcePanel, stack, options);
  if (state.isOcrBusy && state.ocrResults.get(state.pageNum)?.raw?.line_ocr) {
    card.querySelectorAll("button:not(.source-preview-scale-button), select").forEach((control) => { control.disabled = true; });
    card.querySelectorAll('[contenteditable="true"]').forEach((editor) => { editor.contentEditable = "false"; });
  }
  return card;
}

function makeProofreadAiLine(compare, rawAiLine, index, fallbackBbox = null) {
  const line = {
    text: String(rawAiLine?.text || ""),
    bbox: normalizeBbox(rawAiLine?.bbox) || normalizeBbox(fallbackBbox),
    bboxApproximate: Boolean(rawAiLine?.bboxApproximate),
    regionId: rawAiLine?.regionId || rawAiLine?.region_id || "",
    regionLabel: rawAiLine?.regionLabel || rawAiLine?.region_label || "",
    index,
    error: Boolean(rawAiLine?.error),
    missing: Boolean(rawAiLine?.missing),
    diagnostic: Boolean(rawAiLine?.diagnostic),
    provider: String(rawAiLine?.provider || ""),
    model: String(rawAiLine?.model || ""),
    reviewImage: rawAiLine?.reviewImage || rawAiLine?.review_image || null,
    recognitionError: String(rawAiLine?.recognitionError || rawAiLine?.recognition_error || ""),
    regionLineIndex: Number(rawAiLine?.regionLineIndex ?? rawAiLine?.region_line_index ?? 0),
  };
  if (line.reviewImage || line.recognitionError) return line;
  if (shouldShowAiVisionDiagnostic(compare, line, index)) {
    return makeMissingAiVisionLine(compare, index, line.bbox || fallbackBbox);
  }
  return line;
}

function renderProofreadChoiceSelect(index, savedSide, candidateLabel = "Gemini Vision", compare = null) {
  const control = document.createElement("label");
  control.className = "proofread-choice-select-control";
  const label = document.createElement("span");
  label.textContent = "采用";
  const select = document.createElement("select");
  select.className = "proofread-choice-select";
  select.name = `proofread-choice-${state.pageNum}-${index}`;
  select.setAttribute("aria-label", `第 ${index + 1} 个 block 采用版本`);
  const choices = [["bdrc", "BDRC"], ["llm", candidateLabel]];
  if (compare?.qwenReviews?.some((review) => review.index === index)) choices.push(["qwen", "千问候选"]);
  if (compare?.openaiReviews?.some((review) => review.index === index)) choices.push(["openai", "OpenAI 候选"]);
  choices.forEach(([value, text]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  });
  select.value = choices.some(([value]) => value === savedSide) ? savedSide : choices[0][0];
  control.append(label, select);
  return control;
}

function renderSharedErrorActionGroup(index, card) {
  const group = document.createElement("div");
  group.className = "proofread-inline-action-group";
  group.setAttribute("aria-label", "标错操作");
  group.append(
    renderClearSharedErrorButton(index, card),
    renderSharedErrorButton(index, card),
  );
  return group;
}

function renderReviewModelSelector(provider, index, onCatalog = null) {
  const select = document.createElement("select");
  select.className = "review-model-select";
  select.setAttribute("aria-label", `第 ${index + 1} 行 ${provider === "qwen" ? "千问" : "Gemini Vision"}复核模型`);
  const preferenceKey = `tibetan-proofreading-app:review-model:${provider}:${state.cacheKey}:${state.pageNum}:${index}`;
  let preferred = "";
  try { preferred = window.localStorage.getItem(preferenceKey) || ""; } catch (_) { /* storage optional */ }
  const fill = (models) => {
    const chosen = select.value || preferred;
    select.replaceChildren();
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      select.appendChild(option);
    }
    select.value = models.includes(chosen) ? chosen : (models[0] || "");
    select.disabled = !models.length;
    select.dispatchEvent(new Event("change"));
  };
  select.addEventListener("change", () => {
    try { window.localStorage.setItem(preferenceKey, select.value); } catch (_) { /* storage optional */ }
  });
  fill(REVIEW_MODEL_DEFAULTS[provider]);
  if (typeof fetch === "function") {
    const endpoint = getAiVisionLineReviewEndpoint().replace(/\/line-review$/, "/review-models");
    if (!reviewCatalogRequests.has(endpoint)) {
      const request = fetch(endpoint).then(async (response) => {
        if (!response.ok) throw new Error(`模型列表 HTTP ${response.status}`);
        return response.json();
      });
      reviewCatalogRequests.set(endpoint, request);
      request.catch(() => reviewCatalogRequests.delete(endpoint));
    }
    reviewCatalogRequests.get(endpoint).then((catalog) => {
      if (!select.isConnected) return;
      if (Array.isArray(catalog[provider]?.models)) fill(catalog[provider].models);
      select.dataset.reviewConfigured = String(Boolean(catalog[provider]?.configured));
      if (onCatalog) onCatalog(catalog[provider]);
      select.title = provider === "qwen" && !catalog.qwen?.configured
        ? "千问后端尚未配置 key 和对应平台的接口地址。"
        : (catalog[provider]?.billing_note || "模型权限及费用以服务商账号为准。");
    }).catch((error) => { select.title = `模型列表加载失败：${error.message}；当前显示默认模型。`; });
  }
  return select;
}

function renderAiVisionLineReviewButton(index, card, sourceLine, bdrcLine, aiLine) {
  const group = document.createElement("div");
  group.className = "provider-line-review";
  const controls = document.createElement("div");
  controls.className = "review-provider-controls";
  const button = document.createElement("button");
  button.className = "ghost-button compact proofread-ai-review-button";
  button.type = "button";
  button.innerHTML = '<i data-lucide="scan-search"></i><span>重新识别</span>';
  button.title = "将这一行原文紧密裁剪、放大后交给 Gemini Vision 重新识别；不会重新识别整页";
  button.setAttribute("aria-label", `第 ${index + 1} 行 Gemini Vision 重新识别`);
  const canReview = Boolean(normalizeBbox(sourceLine?.bbox) && !sourceLine?.estimated);
  button.disabled = !canReview;
  if (!canReview) {
    button.title = "这一行没有可靠的原图定位坐标，暂时不能单行复核。";
  }
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    reviewOcrLineWithAiVision(index, card, sourceLine, bdrcLine, aiLine);
  });
  const select = renderReviewModelSelector("gemini", index);
  button.dataset.reviewModel = select.value;
  select.addEventListener("change", () => { button.dataset.reviewModel = select.value; });
  const feedback = document.createElement("div");
  feedback.className = "review-feedback";
  feedback.setAttribute("role", "status");
  controls.append(button, select);
  group.append(controls, feedback);
  return group;
}

function renderOpenAiLineReview(index, sourceLine, bdrcLine, aiLine) {
  return renderIndependentLineReview("openai", index, sourceLine, bdrcLine, aiLine);
}

function renderQwenLineReview(index, sourceLine, bdrcLine, aiLine) {
  return renderIndependentLineReview("qwen", index, sourceLine, bdrcLine, aiLine);
}

function renderIndependentLineReview(provider, index, sourceLine, bdrcLine, aiLine) {
  const label = provider === "qwen" ? "千问" : "OpenAI";
  const reviewKey = provider === "qwen" ? "qwenReviews" : "openaiReviews";
  const group = document.createElement("div");
  group.className = "provider-line-review openai-line-review";
  const controls = document.createElement("div");
  controls.className = "review-provider-controls";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button compact";
  button.textContent = `${label} 复核`;
  button.setAttribute("aria-label", `第 ${index + 1} 行 ${label} 复核`);
  button.title = `裁剪放大这一行，通过 ${label} API 独立复核；费用以服务商账号为准。`;
  button.disabled = !normalizeBbox(sourceLine?.bbox) || Boolean(sourceLine?.estimated);
  const feedback = document.createElement("div");
  feedback.className = "openai-review-feedback";
  feedback.setAttribute("role", "status");
  controls.append(button);
  const select = provider === "qwen" ? renderReviewModelSelector("qwen", index, (catalog) => {
    if (!catalog?.configured && !button.disabled) feedback.textContent = "千问后端尚未配置 API key 和对应平台的接口地址。";
  }) : null;
  if (select) controls.append(select);
  group.append(controls, feedback);
  const candidate = getOcrSourceCompare(state.ocrResults.get(state.pageNum))?.[reviewKey]?.find((review) => review.index === index);
  if (candidate) {
    const text = document.createElement("div");
    text.className = "tibetan-text openai-review-candidate";
    text.dataset.reviewProvider = provider;
    text.dataset.sourceRowIndex = String(index);
    renderOcrLineMarkup(text, candidate.text, {sharedErrorRanges: candidate.errorRanges || [], sharedErrorTitle: `${label} 候选：人工标记的错误，需核对原图`});
    text.title = candidate.note
      ? `${label} · ${candidate.model || "未知模型"} · ${candidate.note}`
      : `${label} · ${candidate.model || "未知模型"}`;
    group.append(text);
  }
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (state.batchOcr?.running) {
      feedback.textContent = "请先停止批量识别，再复核单个 block。";
      return;
    }
    const pageNum = state.pageNum;
    const sourceKey = state.cacheKey;
    const original = state.ocrResults.get(pageNum);
    const endpoint = getAiVisionLineReviewEndpoint().replace(/\/line-review$/, `/${provider}-line-review`);
    const selectedModel = select?.value || "";
    button.disabled = true;
    if (select) select.disabled = true;
    feedback.textContent = `${label} 复核中…`;
    try {
      if (select?.dataset.reviewConfigured === "false") throw new Error("千问后端尚未配置 API key 和对应平台的接口地址。");
      const blob = await getCurrentPageImageBlob();
      if (state.pageNum !== pageNum || state.cacheKey !== sourceKey) throw new Error("页面已切换，请返回原页面重试。");
      const parsed = await callAiVisionLineReviewEndpoint(endpoint, blob, sourceLine.bbox, "", selectedModel);
      const text = validateIndependentReviewText(getParsedOcrText(parsed));
      const result = state.ocrResults.get(pageNum);
      if (state.cacheKey !== sourceKey || result !== original) throw new Error("原文或结果已更换，请重新复核。");
      const compare = getOcrSourceCompare(result) || makeEmptyOcrCompare(result);
      const reviews = compare[reviewKey] || [];
      compare[reviewKey] = [...reviews.filter((review) => review.index !== index), {
        index, text, bbox: sourceLine.bbox, model: getOcrResponseModel(parsed.raw) || selectedModel, provider, reviewedAt: new Date().toISOString(),
      }];
      result.compare = compare;
      saveCachedResults();
      if (state.pageNum === pageNum) updateOcrPanelForPage();
    } catch (error) {
      feedback.textContent = `${label} 复核失败：${error.message || error}`;
    } finally {
      if (button.isConnected) button.disabled = false;
      if (select?.isConnected) select.disabled = false;
    }
  });
  return group;
}

function validateIndependentReviewText(value) {
  let text = String(value || "").trim();
  text = text.replace(/^```[^\n]*\n([\s\S]*?)\n```$/, "$1").trim();
  if (!text || /^[{\[]/.test(text) || (!/[\u0f00-\u0fff]/.test(text) && !/^[0-9０-９\s.,:;()/-]+$/.test(text))) {
    throw new Error("模型返回了非藏文转录（可能是无关 JSON 或说明），未作为新候选保存。请换模型复核；原候选保留。");
  }
  return text;
}

function updateIndependentReviewErrors(provider, index, expectedText, range) {
  const result = state.ocrResults.get(state.pageNum);
  const key = provider === "qwen" ? "qwenReviews" : "openaiReviews";
  const candidate = result?.compare?.[key]?.find((review) => review.index === index);
  if (!candidate || candidate.text !== expectedText) return false;
  if (range) {
    const start = clamp(range.start, 0, candidate.text.length);
    const end = clamp(range.end, start, candidate.text.length);
    if (end <= start) return false;
    candidate.errorRanges = [...(candidate.errorRanges || []), {start, end}];
  } else candidate.errorRanges = [];
  result.updatedAt = new Date().toISOString();
  saveCachedResults();
  return true;
}

function renderSharedErrorButton(index, card) {
  const button = document.createElement("button");
  button.className = "ghost-button compact proofread-shared-error-button";
  button.type = "button";
  button.innerHTML = '<i data-lucide="circle-alert"></i><span>标错</span>';
  button.title = "标错：将当前选中的 BDRC、Gemini Vision、千问或 OpenAI 文字标记为错误";
  button.setAttribute("aria-label", "标错");
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => markSelectedSharedError(index, card));
  return button;
}

function renderClearSharedErrorButton(index, card) {
  const button = document.createElement("button");
  button.className = "ghost-button compact proofread-clear-shared-error-button";
  button.type = "button";
  button.innerHTML = '<i data-lucide="eraser"></i><span>撤销标错</span>';
  button.title = "有选区时撤销相交标记；无选区时撤销当前 block 的全部错误标记";
  button.setAttribute("aria-label", "撤销标错");
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => clearSharedErrorMark(index, card));
  return button;
}

function renderProofreadSourcePanel(sourceLine, index) {
  const panel = document.createElement("div");
  panel.className = "proofread-source-panel";
  panel.dataset.sourceRowIndex = String(index);

  const header = document.createElement("div");
  header.className = "proofread-source-header";
  const title = document.createElement("strong");
  const regionLabel = sourceLine?.regionLabel ? `${sourceLine.regionLabel} ` : "";
  const regionLineCount = Number(sourceLine?.regionLineCount || 0);
  const regionCountLabel = regionLineCount > 1 ? `（${regionLineCount}行）` : "";
  title.textContent = sourceLine?.bboxApproximate
    ? `${regionLabel}原文 block ${String(index + 1).padStart(2, "0")} 预览（合并定位）${regionCountLabel}`
    : `${regionLabel}原文 block ${String(index + 1).padStart(2, "0")} 预览${regionCountLabel}`;
  header.append(title, renderSourcePreviewScaleControls());
  panel.appendChild(header);

  const preview = sourceLine?.estimated ? null : createModelInputPreview(sourceLine, index);
  if (preview) {
    panel.classList.add("has-preview");
    panel.appendChild(preview);
  } else {
    const fallback = document.createElement("span");
    fallback.textContent = sourceLine?.estimated
      ? "暂无可靠定位坐标，请在左栏查看整页原文。"
      : "当前 block 没有可用坐标预览，可在左栏查看整页原文。";
    panel.appendChild(fallback);
  }

  if (sourceLine?.bbox && !sourceLine.estimated) {
    panel.classList.add("is-locatable");
    panel.addEventListener("click", () => activateOcrSourceBlock(sourceLine, index));
  }
  return panel;
}

function renderSourcePreviewScaleControls() {
  const controls = document.createElement("div");
  controls.className = "source-preview-scale-controls";
  controls.setAttribute("aria-label", "原文 block 预览缩放");
  controls.append(
    renderSourcePreviewScaleButton("decrease", "zoom-out", "缩小原文 block 预览"),
    renderSourcePreviewScaleButton("increase", "zoom-in", "放大原文 block 预览"),
  );
  return controls;
}

function renderSourcePreviewScaleButton(action, icon, label) {
  const button = document.createElement("button");
  button.className = "icon-button compact source-preview-scale-button";
  button.type = "button";
  button.dataset.scaleAction = action;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<i data-lucide="${icon}"></i>`;
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const delta = action === "increase" ? SOURCE_PREVIEW_SCALE_STEP : -SOURCE_PREVIEW_SCALE_STEP;
    setSourcePreviewScale(state.sourcePreviewScale + delta, true, true);
  });
  return button;
}

function createModelInputPreview(sourceLine, index) {
  if (!normalizeBbox(sourceLine?.bbox)) return null;
  const wrapper = document.createElement("div");
  wrapper.className = "proofread-source-preview";
  wrapper.style.display = "block";
  wrapper.textContent = "正在准备单行裁剪预览…";
  const pageNum = state.pageNum;
  const sourceKey = state.cacheKey;
  const load = async () => {
    try {
      if (pageNum !== state.pageNum || sourceKey !== state.cacheKey) return;
      const result = state.ocrResults.get(pageNum);
      const compare = getOcrSourceCompare(result);
      const metadata = compare?.llm?.lines?.[index]?.reviewImage || sourceLine.reviewImage;
      const blob = await getCurrentPageImageBlob();
      if (pageNum !== state.pageNum || sourceKey !== state.cacheKey) return;
      const data = new FormData();
      data.append("file", blob, makePageImageName());
      data.append("bbox", JSON.stringify(sourceLine.bbox));
      if (metadata) data.append("review_image", JSON.stringify(metadata));
      const endpoint = getAiVisionLineReviewEndpoint().replace(/line-review$/, "line-preview");
      const response = await fetch(endpoint, { method: "POST", body: data });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      if (!wrapper.isConnected || pageNum !== state.pageNum || sourceKey !== state.cacheKey) return;
      wrapper.replaceChildren();
      const note = document.createElement("small");
      note.textContent = payload.exact_match ? "识别用单行裁剪（按左→右排列）" : "单行裁剪预览（尚未保存模型输入记录）";
      wrapper.appendChild(note);
      const strip = document.createElement("div");
      strip.style.display = "flex";
      strip.style.width = "max-content";
      for (const [tileIndex, url] of (payload.images || []).entries()) {
        const img = document.createElement("img");
        img.src = url;
        img.alt = `单行裁剪第 ${tileIndex + 1} 段`;
        const size = payload.review_image?.review_size;
        const shortLine = payload.images.length === 1 && size?.width > size?.height * 2;
        const baseHeight = shortLine
          ? Math.min(160, Math.max(48, (wrapper.clientWidth - 24) * size.height / size.width))
          : 160;
        img.style.height = `${baseHeight * (Number(state.sourcePreviewScale) || 1)}px`;
        img.style.width = "auto";
        img.style.maxWidth = "none";
        strip.appendChild(img);
      }
      wrapper.appendChild(strip);
    } catch (error) {
      wrapper.textContent = `裁剪预览失败：${error.message}`;
    }
  };
  window.setTimeout(() => { if (wrapper.isConnected) void load(); }, 0);
  return wrapper;
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
  // OCR line boxes can stop before Tibetan stacked marks or the final glyph.
  // Add a proportional margin for the preview without changing the source bbox.
  const padX = Math.max(12, rawWidth * 0.18);
  const padY = Math.max(16, rawHeight * 0.75);
  const sx = clamp(rawX - padX, 0, Math.max(0, sourceWidth - 1));
  const sy = clamp(rawY - padY, 0, Math.max(0, sourceHeight - 1));
  const ex = clamp(rawX + rawWidth + padX, sx + 1, sourceWidth);
  const ey = clamp(rawY + rawHeight + padY, sy + 1, sourceHeight);
  const sw = Math.max(1, ex - sx);
  const sh = Math.max(1, ey - sy);

  const wrapper = document.createElement("div");
  wrapper.className = "proofread-source-preview";
  const canvas = document.createElement("canvas");
  const previewScale = clamp(
    Number(state.sourcePreviewScale) || 1,
    SOURCE_PREVIEW_SCALE_MIN,
    SOURCE_PREVIEW_SCALE_MAX,
  );
  // Size each preview from the detected line height. Long lines may exceed
  // the panel width, so the wrapper scrolls horizontally instead of shrinking
  // the text until it becomes unreadable.
  const targetHeight = clamp(96 + rawHeight * 0.35, 112, 180) * previewScale;
  const scale = clamp(targetHeight / sh, 0.75, 3.5);
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  wrapper.appendChild(canvas);
  return wrapper;
}

function renderProofreadEditorGroup({ index, side, label, line, peerLine, compare }) {
  const group = document.createElement("div");
  group.className = `proofread-editor-group ${side === "llm" ? "is-ai" : "is-bdrc"}`;
  const blockNumber = String(index + 1).padStart(2, "0");
  const sourceLabel = side === "llm" ? "Gemini Vision" : "BDRC";
  const regionLabel = line?.regionLabel ? `${line.regionLabel} ` : "";
  const regionLineCount = Number(line?.regionLineCount || 0);

  const labelEl = document.createElement("div");
  labelEl.className = "proofread-editor-label";
  const labelTitle = document.createElement("strong");
  labelTitle.textContent = `${sourceLabel} ${regionLabel}block ${blockNumber} 识别${regionLineCount > 1 ? `（${regionLineCount}行）` : ""}`;
  const labelMeta = document.createElement("span");
  labelMeta.textContent = `${sourceLabel} 识别结果`;
  const statusEl = document.createElement("em");
  statusEl.className = "proofread-editor-status";
  statusEl.hidden = true;
  if (line?.recognitionError) {
    statusEl.textContent = line.recognitionError;
    statusEl.hidden = false;
    statusEl.style.color = "#b42318";
  }
  labelEl.append(labelTitle, labelMeta, statusEl);

  const editor = document.createElement("div");
  editor.className = "proofread-editor proofread-result-editor";
  editor.contentEditable = "true";
  editor.spellcheck = false;
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-multiline", "true");
  editor.setAttribute("aria-label", `第 ${index + 1} 个 block 的 ${label}`);
  editor.dataset.placeholder = `${sourceLabel} block ${blockNumber} 未返回`;
  editor.dataset.proofreadSide = side;
  editor.dataset.sourceRowIndex = String(index);
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
    statusEl.textContent = diagnostic ? (line?.recognitionError || visibleText) : "";
    if (diagnostic) {
      editor.textContent = visibleText;
    } else {
      renderOcrLineMarkup(editor, text, {
        highlightDiff: false,
        sharedErrorRanges: getSharedErrorRanges(compare, side, index, text),
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
    } else {
      activateOcrSourceBlock(null, index, { scrollRows: false });
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

function markSelectedSharedError(index, card) {
  const selection = getSelectedProofreadRange(card);
  if (!selection || selection.index !== index) {
    setStatus("请先在当前 block 的 BDRC、Gemini Vision 或千问/OpenAI 候选文字中选中需要标记为“错误”的字母。", "warn");
    return;
  }

  if (selection.reviewProvider) {
    if (updateIndependentReviewErrors(selection.reviewProvider, index, selection.sourceText, selection)) {
      updateOcrPanelForPage();
      setStatus(`第 ${index + 1} 个 block 的独立候选已标错并保存。`, "ok");
    }
    return;
  }

  const { result, compare } = ensureProofreadCompareResult();
  const sideKey = selection.side === "bdrc" ? "bdrc" : "llm";
  const sourceLabel = sideKey === "bdrc" ? "BDRC" : "Gemini Vision";
  const selectedLine = ensureProofreadLine(compare[sideKey].lines, index);
  const sourceText = String(selectedLine.text || "");
  const start = clamp(selection.start, 0, sourceText.length);
  const end = clamp(selection.end, start, sourceText.length);
  const selectedText = sourceText.slice(start, end);

  if (!selectedText.trim()) {
    setStatus("选中的内容为空，无法标错。", "warn");
    return;
  }

  const mark = {
    id: makeSharedErrorId(index),
    blockIndex: index,
    text: selectedText,
    bdrcRanges: [],
    llmRanges: [],
    ...(sideKey === "bdrc"
      ? { model: compare.bdrc.model || result.ocrProfile || "BDRC", provider: "bdrc" }
      : getAiVisionModelMetadata(compare, result)),
    createdAt: new Date().toISOString(),
  };
  mark[sideKey === "bdrc" ? "bdrcRanges" : "llmRanges"] = [{ start, end }];

  compare.sharedErrors = normalizeSharedErrorMarks([...(compare.sharedErrors || []), mark]);
  result.compare = compare;
  result.updatedAt = new Date().toISOString();
  state.ocrResults.set(state.pageNum, result);
  saveCachedResults();
  renderCurrentOcrView();
  setStatus(`第 ${index + 1} 个 block 已在 ${sourceLabel} 结果中标记“错误”。`, "ok");
}

function clearSharedErrorMark(index, card) {
  const candidateSelection = getSelectedProofreadRange(card);
  if (candidateSelection?.reviewProvider && candidateSelection.index === index) {
    const result = state.ocrResults.get(state.pageNum);
    const key = candidateSelection.reviewProvider === "qwen" ? "qwenReviews" : "openaiReviews";
    const candidate = result?.compare?.[key]?.find((review) => review.index === index);
    if (candidate && candidate.text === candidateSelection.sourceText) {
      candidate.errorRanges = (candidate.errorRanges || []).filter((range) => !rangesOverlap(range.start, range.end, candidateSelection.start, candidateSelection.end));
      saveCachedResults();
      updateOcrPanelForPage();
      setStatus("已清除候选选区中的错误标记。", "ok");
    }
    return;
  }
  const { result, compare } = ensureProofreadCompareResult();
  const before = compare.sharedErrors?.length || 0;
  if (!before) {
    setStatus("当前页还没有“错误”标记。", "warn");
    return;
  }

  const selection = getSelectedProofreadRange(card);
  let nextMarks;
  if (selection && selection.index === index) {
    const sideKey = selection.side === "bdrc" ? "bdrc" : "llm";
    const selectedRange = {
      start: Math.min(selection.start, selection.end),
      end: Math.max(selection.start, selection.end),
    };
    nextMarks = compare.sharedErrors.filter((mark) => (
      mark.blockIndex !== index || !sharedErrorMarkOverlaps(mark, sideKey, selectedRange)
    ));
  } else {
    nextMarks = compare.sharedErrors.filter((mark) => mark.blockIndex !== index);
  }

  compare.sharedErrors = normalizeSharedErrorMarks(nextMarks);
  if (compare.sharedErrors.length === before) {
    setStatus("当前选区没有命中“错误”标记。", "warn");
    return;
  }

  result.compare = compare;
  result.updatedAt = new Date().toISOString();
  state.ocrResults.set(state.pageNum, result);
  saveCachedResults();
  renderCurrentOcrView();
  setStatus(`已清除第 ${index + 1} 个 block 的“错误”标记。`, "ok");
}

async function reviewOcrLineWithAiVision(index, card, sourceLine, bdrcLine, aiLine) {
  if (state.batchOcr?.running && card) {
    setStatus("请先停止批量识别，再复核单个 block。", "warn");
    return;
  }
  const pageNum = state.pageNum;
  const originalResult = state.ocrResults.get(pageNum);
  const sourceKey = state.cacheKey;
  const bbox = normalizeBbox(sourceLine?.bbox || getSourceLineForRow(aiLine, bdrcLine)?.bbox);
  if (!bbox || sourceLine?.estimated) {
    setStatus("这一行没有可靠的原图定位坐标，不能进行单行 Gemini Vision 复核。", "warn");
    return;
  }
  const endpoint = getAiVisionLineReviewEndpoint();
  if (!endpoint) {
    setStatus("请先填写 Gemini Vision OCR 接口地址。", "warn");
    return;
  }

  const button = card?.querySelector(".proofread-ai-review-button");
  const feedback = card?.querySelector(".review-feedback");
  const selectedModel = button?.dataset.reviewModel || "";
  if (feedback) feedback.textContent = "Gemini Vision 复核中…";
  if (button) {
    button.disabled = true;
    button.dataset.originalLabel = button.textContent || "重新识别";
    button.textContent = "复核中…";
  }
  try {
    setStatus(`正在紧密裁剪并放大第 ${index + 1} 行，交给 Gemini Vision 复核…`, "warn");
    const blob = await getCurrentPageImageBlob();
    const draftText = isDiagnosticOcrLine(aiLine)
      ? String(bdrcLine?.text || "")
      : String(aiLine?.text || bdrcLine?.text || "");
    if (state.pageNum !== pageNum || state.cacheKey !== sourceKey) throw new Error("页面已切换，请返回原页面重试。");
    const reviewImage = aiLine?.reviewImage || sourceLine?.reviewImage || bdrcLine?.reviewImage || null;
    const parsed = await callAiVisionLineReviewEndpoint(endpoint, blob, bbox, draftText, selectedModel, reviewImage, sourceLine?.regionId || "");
    const reviewedText = getParsedOcrText(parsed);
    if (!reviewedText) {
      throw new Error("Gemini Vision 未返回这一行的可用文字");
    }

    const result = state.ocrResults.get(pageNum);
    if (!result || state.cacheKey !== sourceKey || result.raw !== originalResult?.raw) {
      throw new Error("原文或识别结果已变更，请在原页面重新复核");
    }
    const compare = getOcrSourceCompare(result) || makeEmptyOcrCompare(result);
    const targetLine = ensureProofreadLine(compare.llm.lines, index, sourceLine || bdrcLine);
    targetLine.text = reviewedText;
    targetLine.reviewImage = parsed.raw?.review_image || null;
    targetLine.bbox = bbox;
    targetLine.bboxApproximate = false;
    targetLine.error = false;
    targetLine.missing = false;
    targetLine.diagnostic = false;
    compare.llm.text = compare.llm.lines.map((line) => line.text || "").join("\n").trim();
    compare.llm.returnedLineCount = countNonEmptyOcrLines(compare.llm.lines);
    compare.llm.model = getOcrResponseModel(parsed.raw) || compare.llm.model || "Gemini Vision";
    compare.llm.provider = getOcrResponseProvider(parsed.raw) || compare.llm.provider;
    targetLine.provider = "gemini";
    targetLine.model = compare.llm.model;
    if (isMissingOcrTranscription(result.lines?.[index])) {
      result.lines = result.lines.map((line, lineIndex) => lineIndex === index
        ? { ...line, text: reviewedText, missing: false, error: false, diagnostic: false, model: compare.llm.model, recognitionSource: "ai-line-review" }
        : line);
      result.text = result.lines.map((line) => line.text || "").join("\n");
    }
    result.compare = compare;
    result.updatedAt = new Date().toISOString();
    state.ocrResults.set(pageNum, result);
    saveCachedResults();
    if (state.pageNum === pageNum) updateOcrPanelForPage();
    updateSummary();
    setStatus(`第 ${index + 1} 行已由 Gemini Vision 单行复核；请确认后选择“采用 Gemini Vision”并保存。`, "ok");
  } catch (error) {
    if (feedback) feedback.textContent = `Gemini Vision 复核失败：${formatNetworkError(error, endpoint, "ai-ocr")}`;
    setStatus(`第 ${index + 1} 行 Gemini Vision 复核失败：${formatNetworkError(error, endpoint, "ai-ocr")}`, "error");
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="scan-search"></i><span>重新识别</span>';
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

function saveProofreadBlockChoice(index, side, card) {
  const { result, compare } = ensureProofreadCompareResult();
  const selectedProviderLabel = side === "qwen" ? "千问" : side === "openai" ? "OpenAI" : side === "llm" ? "Gemini Vision" : "BDRC";
  const candidateProvider = side === "qwen" || side === "openai" ? side : "";
  if (candidateProvider) {
    const candidate = compare[`${candidateProvider}Reviews`]?.find((review) => review.index === index);
    if (!candidate) {
      setStatus(`当前 block 没有可采用的${candidateProvider === "qwen" ? "千问" : "OpenAI"}候选。`, "warn");
      return;
    }
    const target = ensureProofreadLine(compare.llm.lines, index, candidate);
    Object.assign(target, { text: candidate.text, bbox: normalizeBbox(candidate.bbox) || target.bbox, missing: false, error: false, diagnostic: false, model: candidate.model, provider: candidateProvider });
    compare.llm.text = compare.llm.lines.map((line) => line.text || "").join("\n").trim();
    compare.llm.model = candidate.model || "";
    compare.llm.provider = candidateProvider;
    side = "llm";
  }
  const sideKey = side === "bdrc" ? "bdrc" : "llm";
  const peerKey = sideKey === "bdrc" ? "llm" : "bdrc";
  const selectedLine = ensureProofreadLine(compare[sideKey].lines, index, compare[peerKey].lines[index]);
  if (sideKey === "llm" && isDiagnosticOcrLine(selectedLine)) {
    setStatus("Gemini Vision 当前没有可保存的识别文本；请重新识别，或先手动编辑该 Gemini Vision block。", "warn");
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
  if (sideKey === "llm") {
    saveOcrQualityReview({ result, compare, pageNum: state.pageNum, blockIndex: index, text: selectedLine.text || "" });
  }
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
    const choiceSelect = card.querySelector(".proofread-choice-select");
    if (choiceSelect) {
      choiceSelect.value = sideKey;
    }
    const saveButton = card.querySelector(".proofread-save-button");
    if (saveButton) {
      saveButton.classList.add("is-saved");
      window.setTimeout(() => saveButton.classList.remove("is-saved"), 1600);
    }
  }
  setStatus(`第 ${index + 1} 个 block 已保存为 ${selectedProviderLabel} 版本。`, "ok");
}

function getCurrentOcrCompareOrEmpty() {
  if (!state.pageCount) {
    return {
      note: "请先加载 PDF 或图片；选择“智能（BDRC + LLM）”识别后，BDRC 与 Gemini Vision 会分别显示在两个独立栏。",
      bdrc: normalizeOcrCompareSide({ label: "BDRC", text: "", lines: [] }),
      llm: normalizeOcrCompareSide({ label: "Gemini Vision / LLM", text: "", lines: [] }),
    };
  }

  const result = state.ocrResults.get(state.pageNum);
  return getOcrSourceCompare(result) || makeEmptyOcrCompare(result);
}

function renderOcrSourceSide(container, sideData, peerData, side, compare = null) {
  container.innerHTML = "";
  const lines = getEffectiveOcrSideLines(sideData);
  const peerLines = getEffectiveOcrSideLines(peerData, lines);
  const hasText = Boolean(String(sideData.text || "").trim() || lines.some((line) => String(line.text || "").trim()));

  if (!hasText && !lines.some((line) => line.error)) {
    const empty = document.createElement("div");
    empty.className = "line-compare-empty";
    const message = side === "bdrc"
      ? "BDRC OCR 结果会显示在这里。"
      : "Gemini Vision OCR 结果会显示在这里。";
    empty.innerHTML = `<strong>等待结果</strong><span>${message}</span>`;
    container.appendChild(empty);
    return;
  }

  container.appendChild(renderOcrSourceRows({
    lines,
    peerLines,
    rowCount: Math.max(lines.length, peerLines.length, 1),
    side,
    compare,
  }));
}

function getOcrSourceCompare(result) {
  if (!result) return null;
  const storedCompare = normalizeOcrCompare(result.compare);
  const rawCompare = makeOcrCompareFromRawResult(result);
  if (storedCompare) {
    if (result.source === "bdrc") {
      const originalLines = result.lines?.length ? result.lines : extractOcrLines(result.raw);
      storedCompare.bdrc.lines = storedCompare.bdrc.lines.map((line, index) => ({
        ...originalLines[index], ...line,
        bbox: line.bbox || originalLines[index]?.bbox || null,
        regionLabel: line.regionLabel || originalLines[index]?.regionLabel || "",
        regionId: line.regionId || originalLines[index]?.regionId || "",
        regionLineIndex: originalLines[index]?.regionLineIndex ?? index,
      }));
      if (!hasOcrSideContent(storedCompare.bdrc)) storedCompare.bdrc = makeEmptyOcrCompare(result).bdrc;
    }
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
  return rawCompare || makeAiOnlyCompareWithBdrcDiagnostic(result) || (result.text ? makeEmptyOcrCompare(result) : null);
}

function isMissingOcrTranscription(line) {
  return Boolean(line?.missing || /〔.*(?:待人工|待识别|复核).*〕/.test(line?.text || ""));
}

function getPrimaryOcrDisplay(compare) {
  const useBdrc = hasOcrSideContent(compare.bdrc) && !compare.bdrc.error;
  if (!useBdrc) return { side: compare.llm, peer: null, key: "llm" };
  const result = state.ocrResults.get(state.pageNum);
  const lines = getEffectiveOcrSideLines(compare.bdrc).map((line, index) => {
    const finalLine = result?.lines?.[index];
    const reviewed = compare.llm.lines?.[index];
    if (result?.source === "proofread" && finalLine) return { ...line, ...finalLine };
    if (isMissingOcrTranscription(line) && reviewed?.text && !isDiagnosticOcrLine(reviewed)) {
      return { ...line, text: reviewed.text, missing: false, error: false, diagnostic: false };
    }
    return line;
  });
  return { side: { ...compare.bdrc, lines, text: lines.map(line => line.text).join("\n") }, peer: compare.llm, key: "bdrc" };
}

function isAiOnlyMode() {
  return Boolean(document.querySelector(".app-shell")?.classList.contains("ai-only-mode"));
}

function getAiOnlyDisplayCompare(compare) {
  if (!compare || !isAiOnlyMode()) return compare;
  const llm = normalizeOcrCompareSide(compare.llm || { label: "Gemini Vision / LLM", text: "", lines: [] });
  return {
    ...compare,
    note: "当前仅显示 Gemini Vision 识别结果。",
    bdrc: normalizeOcrCompareSide({ label: "BDRC", text: "", lines: [] }),
    llm,
  };
}

function makeAiOnlyCompareWithBdrcDiagnostic(result) {
  if (!result || result.source !== "ai-vision") return null;
  const aiText = String(result.text || "").trim();
  const aiLines = result.lines?.length ? result.lines : extractOcrLines(result.raw);
  if (!aiText && !aiLines.length) return null;

  const bdrcError = isCloudDeployment()
    ? "Zeabur 线上服务未配置 BDRC_OCR_UPSTREAM_URL，当前只能显示 Gemini Vision 识别结果。"
    : "当前页只有 Gemini Vision 结果；请切换到智能识别并确认 BDRC 服务可用后重新识别。";

  return normalizeOcrCompare({
    note: "当前页是旧版 Gemini Vision 单栏结果；BDRC 初稿不可用，已在左栏显示原因。",
    bdrc: {
      label: "BDRC",
      text: "",
      lines: [{
        text: `BDRC 当前不可用：${bdrcError}`,
        bbox: null,
        index: 0,
        error: true,
      }],
      error: true,
    },
    llm: {
      label: "Gemini Vision / LLM",
      text: aiText,
      lines: aiLines.length ? aiLines : makeOcrLinesFromText(aiText),
      model: getOcrResponseModel(result.raw),
      provider: getOcrResponseProvider(result.raw),
      returnedLineCount: aiLines.length || countTextLines(aiText),
      expectedLineCount: aiLines.length || countTextLines(aiText),
    },
  });
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
      ? `Gemini Vision 调用未返回可用文本：${result.raw.ai_error}`
      : "左栏为 BDRC OCR 初稿，右栏为 Gemini Vision / LLM 识别或复核结果。",
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
    return explicitText || "Gemini Vision 调用失败；请检查 AI OCR 服务后重新识别当前页。";
  }
  if (hasOcrSideContent(side)) {
    return `Gemini Vision 未返回 block ${String(index + 1).padStart(2, "0")} 的识别结果；模型可能只返回了前几行，请重新识别当前页。`;
  }
  return "Gemini Vision 未返回文本；请重新识别当前页，或检查 18092 AI OCR 服务。";
}

function renderOcrSourceComparison(compare) {
  const wrapper = document.createElement("section");
  wrapper.className = "ocr-source-compare";

  const note = document.createElement("div");
  note.className = "ocr-source-compare-note";
  note.textContent = compare.note || "左栏为 BDRC OCR 初稿，右栏为 Gemini Vision / LLM 识别或复核结果。";
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
      compare,
    })
  );
  columns.appendChild(
    renderOcrSourceColumn({
      title: "Gemini Vision / LLM",
      subtitle: "智能识别或复核",
      lines: llmLines,
      peerLines: bdrcLines,
      rowCount,
      side: "llm",
      compare,
    })
  );
  wrapper.appendChild(columns);

  return wrapper;
}

function renderOcrSourceRows({ lines, peerLines, rowCount, side, compare = null }) {
  const body = document.createElement("div");
  body.className = `ocr-source-column-body ocr-source-single-body ${side === "bdrc" ? "is-bdrc" : "is-llm"}`;
  const count = Math.max(1, rowCount);
  for (let index = 0; index < count; index += 1) {
    const line = lines[index] || { text: "" };
    const peerLine = peerLines[index] || { text: "" };
    const row = document.createElement("div");
    row.className = "ocr-source-column-row";
    row.dataset.sourceRowIndex = String(index);
    row.dataset.sourceSide = side;
    row.classList.remove("has-difference");
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
        highlightDiff: false,
        sharedErrorRanges: getSharedErrorRanges(compare, side, index, line.text || ""),
      });
    }

    const sourceLine = getSourceLineForRow(line, peerLine);
    const showLineReview = side === "bdrc" || isAiOnlyMode();
    if (showLineReview) {
      const actions = document.createElement("div");
      actions.className = "ocr-source-line-actions";
      actions.appendChild(renderQwenLineReview(index, sourceLine, side === "bdrc" ? line : peerLine, side === "llm" ? line : peerLine));
      actions.appendChild(renderOpenAiLineReview(index, sourceLine, side === "bdrc" ? line : peerLine, side === "llm" ? line : peerLine));
      row.classList.add("has-line-review");
      row.append(number, text, actions);
    } else {
      row.append(number, text);
    }
    row.classList.add("is-locatable");
    row.addEventListener("click", () => activateOcrSourceBlock(sourceLine, index));
    body.appendChild(row);
  }
  return body;
}

function renderOcrSourceColumn({ title, subtitle, lines, peerLines, rowCount, side, compare = null }) {
  const column = document.createElement("article");
  column.className = `ocr-source-column ${side === "bdrc" ? "is-bdrc" : "is-llm"}`;

  const header = document.createElement("div");
  header.className = "ocr-source-column-header";
  header.innerHTML = `<strong>${title}</strong><span>${subtitle}</span>`;
  column.appendChild(header);

  column.appendChild(renderOcrSourceRows({ lines, peerLines, rowCount, side, compare }));
  return column;
}

function makeEmptyOcrCompare(result) {
  let note = "选择“智能（BDRC + LLM）”后点击“识别”，BDRC 与 Gemini Vision 会分别显示在两个独立栏。";
  let bdrcText = "";
  let llmText = "";
  if (result?.source === "bdrc") {
    bdrcText = result.text || "";
    note = "当前只有 BDRC 结果；请用“智能（BDRC + LLM）”重新识别，生成右栏 Gemini Vision / LLM。";
  } else if (result?.source === "ai-vision") {
    llmText = result.text || "";
    note = "当前只有 Gemini Vision 结果；请用“智能（BDRC + LLM）”重新识别，生成左栏 BDRC。";
  } else if (result?.text) {
    bdrcText = result.text;
    note = "当前是旧缓存或直接文本结果；请用“智能（BDRC + LLM）”重新识别当前页。";
  }
  return {
    note,
    bdrc: normalizeOcrCompareSide({ label: "BDRC", text: bdrcText, lines: bdrcText ? (result?.lines?.length ? result.lines : extractOcrLines(result?.raw).length ? extractOcrLines(result.raw) : makeOcrLinesFromText(bdrcText)) : [] }),
    llm: normalizeOcrCompareSide({
      label: "Gemini Vision / LLM",
      text: llmText,
      lines: llmText ? (result?.lines?.length ? result.lines : makeOcrLinesFromText(llmText)) : [],
      model: getOcrResponseModel(result?.raw),
      provider: getOcrResponseProvider(result?.raw),
      returnedLineCount: countTextLines(llmText),
    }),
    sharedErrors: [],
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
      bboxApproximate: Boolean(line?.bboxApproximate || textLines[index]?.bboxApproximate || fallbackLines[index]?.bboxApproximate),
      reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
      regionId: line?.regionId || line?.region_id || textLines[index]?.regionId || "",
      regionLabel: line?.regionLabel || line?.region_label || textLines[index]?.regionLabel || "",
      regionLineCount: Number(line?.regionLineCount || line?.region_line_count || textLines[index]?.regionLineCount || 0) || 0,
      model: String(line?.model || ""),
      provider: String(line?.provider || ""),
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
  const sharedErrorRanges = normalizeTextRanges(options.sharedErrorRanges || []);
  const boundaries = Array.from(new Set([
    0,
    text.length,
    ...highRiskRanges.flatMap((range) => [range.start, range.end]),
    ...diffRanges.flatMap((range) => [range.start, range.end]),
    ...sharedErrorRanges.flatMap((range) => [range.start, range.end]),
  ])).sort((a, b) => a - b);

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (end <= start) continue;
    const segment = text.slice(start, end);
    if (!segment) continue;

    const highRisk = highRiskRanges.some((range) => rangesOverlap(start, end, range.start, range.end));
    const different = diffRanges.some((range) => rangesOverlap(start, end, range.start, range.end));
    const sharedError = sharedErrorRanges.some((range) => rangesOverlap(start, end, range.start, range.end));
    if (!highRisk && !different && !sharedError) {
      container.appendChild(document.createTextNode(segment));
      continue;
    }

    const mark = document.createElement("span");
    mark.className = [
      highRisk ? "ocr-risk-inline" : "",
      different ? "ocr-diff-inline" : "",
      sharedError ? "ocr-shared-error-inline" : "",
    ].filter(Boolean).join(" ");
    mark.title = [
      highRisk ? "高危：包含藏文上下加字或组合符，优先人工校对" : "",
      different ? "差异：BDRC 与 Gemini Vision 此处不一致" : "",
      sharedError ? (options.sharedErrorTitle || "错误：BDRC 与 Gemini Vision 都疑似识别错误，需人工改正") : "",
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

function getSharedErrorRanges(compare, side, blockIndex, text = "") {
  const sideKey = side === "bdrc" ? "bdrc" : "llm";
  const rangesKey = sideKey === "bdrc" ? "bdrcRanges" : "llmRanges";
  const textLength = String(text || "").length;
  if (!compare?.sharedErrors?.length || !textLength) return [];
  return mergeRanges(compare.sharedErrors
    .filter((mark) => mark.blockIndex === blockIndex)
    .flatMap((mark) => mark[rangesKey] || [])
    .map((range) => ({
      start: clamp(Number(range.start), 0, textLength),
      end: clamp(Number(range.end), 0, textLength),
    }))
    .filter((range) => range.end > range.start));
}

function makeSharedErrorId(index) {
  return `shared-error-${state.pageNum}-${index}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSelectedProofreadRange(card) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const anchorNode = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  const editor = anchorNode?.closest?.(".proofread-editor, .openai-review-candidate");
  if (!editor || !card?.contains(editor)) return null;

  const side = editor.dataset.proofreadSide === "bdrc" ? "bdrc" : "llm";
  const index = Number(editor.dataset.sourceRowIndex);
  if (!Number.isInteger(index)) return null;

  const startProbe = range.cloneRange();
  startProbe.selectNodeContents(editor);
  startProbe.setEnd(range.startContainer, range.startOffset);
  const endProbe = range.cloneRange();
  endProbe.selectNodeContents(editor);
  endProbe.setEnd(range.endContainer, range.endOffset);
  const editorText = editor.textContent || "";
  const textLength = editorText.length;
  const start = clamp(startProbe.toString().length, 0, textLength);
  const end = clamp(endProbe.toString().length, start, textLength);
  return {
    side,
    index,
    start,
    end,
    reviewProvider: editor.dataset.reviewProvider || "",
    sourceText: editorText,
    text: editorText.slice(start, end),
  };
}

function findPeerSharedErrorRange({ selectedText, selectedRange, peerText }) {
  const source = String(selectedText || "");
  const peer = String(peerText || "");
  if (!source.trim() || !peer) return null;

  const sameOffset = peer.slice(selectedRange.start, selectedRange.end);
  if (sameOffset === source) {
    return { start: selectedRange.start, end: selectedRange.end };
  }

  const exactIndex = peer.indexOf(source);
  if (exactIndex >= 0) {
    return { start: exactIndex, end: exactIndex + source.length };
  }

  return null;
}

function sharedErrorMarkOverlaps(mark, side, selectedRange) {
  const ranges = side === "bdrc" ? mark.bdrcRanges : mark.llmRanges;
  return (ranges || []).some((range) => (
    rangesOverlap(selectedRange.start, selectedRange.end, range.start, range.end)
  ));
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
  if (!line?.regionLabel && peerLine?.regionLabel && normalizeBbox(peerLine.bbox)) return peerLine;
  if (normalizeBbox(line?.bbox)) return line;
  if (normalizeBbox(peerLine?.bbox)) return peerLine;
  return null;
}

function getVisibleSourceElement() {
  const candidates = [els.imagePage, els.pdfCanvas];
  return candidates.find((source) => {
    if (!source) return false;
    const style = window.getComputedStyle(source);
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      source.clientWidth > 0 &&
      source.clientHeight > 0;
  }) || null;
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
  if (state.activeOcrLine < 0) return;

  const blocks = getCurrentSourceBlockRecords();
  if (!blocks.length) return;

  const fragment = document.createDocumentFragment();
  blocks.forEach((block) => {
    if (block.index !== state.activeOcrLine || block.estimated) return;
    const box = getSourceOverlayBox(block.bbox, source);
    if (!box) return;

    const item = document.createElement("div");
    item.className = [
      "source-sync-block",
      block.hasBdrc ? "has-bdrc" : "",
      block.hasAi ? "has-ai" : "",
      block.hasDifference ? "has-difference" : "",
      block.estimated ? "is-estimated" : "",
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
    const aiLines = getEffectiveOcrSideLines(compare.llm);
    const count = aiLines.length;
    return Array.from({ length: count }, (_, index) => {
      const aiLine = aiLines[index] || { text: "" };
      return makeSourceBlockRecord({
        index,
        line: getSourceLineForRow(aiLine, null) || makeEstimatedSourceLineForRow(index, count),
        hasBdrc: false,
        hasAi: Boolean(String(aiLine.text || "").trim()),
        hasDifference: false,
      });
    }).filter(Boolean);
  }

  const lines = result.lines?.length ? result.lines : extractOcrLines(result.raw);
  return (lines || [])
    .map((line, index) => makeSourceBlockRecord({
      index,
      line: getSourceLineForRow(line, null),
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
    estimated: Boolean(line?.estimated),
    hasBdrc,
    hasAi,
    hasDifference,
  };
}

function makeEstimatedSourceLineForRow(index, rowCount) {
  const count = Math.max(1, Number(rowCount) || 1);
  const contentTop = 0.14;
  const contentBottom = 0.92;
  const step = (contentBottom - contentTop) / count;
  return {
    bbox: {
      x: 0.08,
      y: clamp(contentTop + index * step, 0, 0.96),
      width: 0.84,
      height: Math.max(0.018, Math.min(0.055, step * 0.86)),
    },
    estimated: true,
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
  const horizontalPadding = getSourceHorizontalPadding(rawHeight);
  const verticalPadding = getSourceVerticalPadding(rawHeight);
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
  renderSourceBlockOverlay();
  setActiveSourceBlock(index);
  if (options.scrollRows) {
    scrollOcrRowsIntoView(index);
  }
  if (line?.estimated) {
    showSourceLineHighlight(null);
    return;
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
  renderSourceBlockOverlay();
  setActiveSourceBlock(index);
  showSourceLineHighlight(line);
}

function showSourceLineHighlight(line, options = {}) {
  const bbox = line?.bbox || line;
  const normalized = normalizeBbox(bbox);
  const source = getVisibleSourceElement();
  if (!normalized || !source) {
    els.sourceLineHighlight.classList.remove("is-visible");
    return;
  }

  const sourceWidth = source.clientWidth;
  const sourceHeight = source.clientHeight;
  const viewportRect = els.pageViewport.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  const sourceLeft = sourceRect.left - viewportRect.left + els.pageViewport.scrollLeft;
  const sourceTop = sourceRect.top - viewportRect.top + els.pageViewport.scrollTop;
  const rawLeft = sourceLeft + normalized.x * sourceWidth;
  const rawWidth = normalized.width * sourceWidth;
  const rawTop = sourceTop + normalized.y * sourceHeight;
  const rawHeight = normalized.height * sourceHeight;
  const horizontalPadding = getSourceHorizontalPadding(rawHeight);
  const verticalPadding = getSourceVerticalPadding(rawHeight);
  const left = Math.max(sourceLeft, rawLeft - horizontalPadding);
  const width = Math.max(6, Math.min(sourceLeft + sourceWidth - left, rawWidth + horizontalPadding * 2));
  const top = Math.max(sourceTop, rawTop - verticalPadding);
  const height = Math.max(12, Math.min(sourceTop + sourceHeight - top, rawHeight + verticalPadding * 2));
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
  const line = getSourceLineByIndex(state.activeOcrLine);
  renderSourceBlockOverlay();
  setActiveSourceBlock(state.activeOcrLine);
  showSourceLineHighlight(line);
}

function getSourceLineByIndex(index) {
  const result = state.ocrResults.get(state.pageNum);
  const compare = getOcrSourceCompare(result);
  if (compare) {
    const bdrcLines = getEffectiveOcrSideLines(compare.bdrc);
    const aiLines = getEffectiveOcrSideLines(compare.llm, bdrcLines);
    const count = Math.max(bdrcLines.length, aiLines.length);
    return getSourceLineForRow(bdrcLines[index], aiLines[index]);
  }
  const lines = result?.lines?.length ? result.lines : extractOcrLines(result?.raw);
  return getSourceLineForRow(lines?.[index], null);
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
  const pages = [...state.ocrResults.entries()]
    .map(([pageNum, result]) => [pageNum, String(result?.text || "").trim()])
    .filter(([, text]) => text)
    .sort((a, b) => a[0] - b[0]);

  if (!pages.length) {
    setStatus("还没有可下载的 OCR 校对结果。", "warn");
    return;
  }

  const body = buildProofreadMarkdown(pages, state.sourceName);
  const blob = new Blob(["\uFEFF", body], { type: "text/markdown;charset=utf-8" });
  const safeName = (state.sourceName || "bdrc-ocr").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_");
  downloadBlob(blob, `${safeName}_藏文OCR校对结果.md`);
  setStatus(`已下载 Markdown 校对结果，共 ${pages.length} 页。`, "ok");
}

function buildProofreadMarkdown(pages, sourceName) {
  return [
    `# ${stripFileExtension(sourceName || "藏文典籍")} 藏文 OCR 校对结果`,
    "",
    ...pages.flatMap(([pageNum, text]) => [
      `## 第 ${pageNum} 页`,
      "",
      text,
      "",
    ]),
    ...buildOcrModelQualityMarkdown(state.ocrQualityReviews),
  ].join("\n");
}

function getAiVisionModelMetadata(compare, result) {
  const model = String(compare?.llm?.model || getOcrResponseModel(result?.raw) || "未知模型").trim() || "未知模型";
  const provider = String(compare?.llm?.provider || getOcrResponseProvider(result?.raw) || "").trim();
  return {
    model,
    provider,
    requestId: getOcrResponseRequestId(result?.raw),
    ocrRunAt: String(compare?.llm?.recognizedAt || result?.updatedAt || ""),
  };
}

function getOcrResponseRequestId(raw) {
  if (!raw || typeof raw !== "object") return "";
  return String(raw.requestId || raw.request_id || raw.id || raw.raw?.requestId || raw.raw?.request_id || raw.raw?.id || "").trim();
}

function countOcrCharacters(text) {
  return Array.from(String(text || "").replace(/\s+/g, "")).length;
}

function saveOcrQualityReview({ result, compare, pageNum, blockIndex, text }) {
  const metadata = getAiVisionModelMetadata(compare, result);
  const reviewedChars = countOcrCharacters(text);
  if (!reviewedChars) return;
  const errorChars = getSharedErrorRanges(compare, "llm", blockIndex, text)
    .reduce((sum, range) => sum + countOcrCharacters(String(text || "").slice(range.start, range.end)), 0);
  const matchIndex = state.ocrQualityReviews.findIndex((review) => (
    review.pageNum === pageNum &&
    review.blockIndex === blockIndex &&
    review.model === metadata.model &&
    review.provider === metadata.provider &&
    review.ocrRunAt === metadata.ocrRunAt
  ));
  const review = {
    id: matchIndex >= 0 ? state.ocrQualityReviews[matchIndex].id : `quality-review-${pageNum}-${blockIndex}-${Date.now().toString(36)}`,
    pageNum,
    blockIndex,
    ...metadata,
    reviewedAt: new Date().toISOString(),
    reviewedChars,
    errorChars: Math.min(errorChars, reviewedChars),
  };
  if (matchIndex >= 0) {
    state.ocrQualityReviews.splice(matchIndex, 1, review);
  } else {
    state.ocrQualityReviews.push(review);
  }
}

function buildOcrModelQualityMarkdown(reviews) {
  if (!reviews.length) {
    return ["## 模型质检统计", "", "尚无已保存的人工审核 block。", ""];
  }
  const stats = new Map();
  reviews.forEach((review) => {
    const key = `${review.provider}::${review.model}`;
    const current = stats.get(key) || { model: review.model, provider: review.provider, reviewedChars: 0, errorChars: 0, blockCount: 0 };
    current.reviewedChars += review.reviewedChars;
    current.errorChars += review.errorChars;
    current.blockCount += 1;
    stats.set(key, current);
  });
  const rows = [...stats.values()]
    .map((item) => ({ ...item, estimatedAccuracy: item.reviewedChars ? (item.reviewedChars - item.errorChars) / item.reviewedChars : 0 }))
    .sort((left, right) => right.estimatedAccuracy - left.estimatedAccuracy || right.reviewedChars - left.reviewedChars);
  return [
    "## 模型质检统计",
    "",
    "仅统计人工标错后并点击“保存”的 Gemini Vision block；估算准确率 = 1 - 标错字符数 / 已审核字符数。样本量较小时仅供参考。",
    "",
    "| 模型 | 服务 | 已审核 block | 已审核字符 | 标错字符 | 估算准确率 |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...rows.map((item) => `| ${item.model} | ${item.provider || "-"} | ${item.blockCount} | ${item.reviewedChars} | ${item.errorChars} | ${(item.estimatedAccuracy * 100).toFixed(2)}% |`),
    "",
  ];
}

function stripFileExtension(fileName) {
  return String(fileName || "").replace(/\.[^.]+$/, "");
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
    setStatus("还没有可导出的 Gemini Vision OCR 文本。", "warn");
    return;
  }

  const body = [
    `# ${state.sourceName || "Gemini Vision OCR"} 识别结果`,
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
  setStatus("已导出全部 Gemini Vision OCR 文本。", "ok");
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
  const profile = OCR_PROFILES[result?.ocrProfile] || getSelectedOcrProfile();
  const sourceCompare = getAiOnlyDisplayCompare(getOcrSourceCompare(result));
  const hasAiError = Boolean(sourceCompare?.llm?.error || sourceCompare?.llm?.lines?.some((line) => line.error));
  if (result?.source === "pdf-text") {
    els.ocrTitle.textContent = `第 ${state.pageNum} 页文本层`;
  } else if (state.sourceType === "word") {
    els.ocrTitle.textContent = "Word 文本";
  } else if (state.sourceType === "markdown" || state.sourceType === "text") {
    els.ocrTitle.textContent = state.sourceType === "text" ? "文本文件" : "Markdown 文本";
  } else {
    const engineLabel = result?.source === "bdrc" ? `BDRC · ${profile.label}` : "Gemini Vision";
    els.ocrTitle.textContent = state.sourceType === "image"
      ? `图片 ${engineLabel}`
      : `第 ${state.pageNum} 页 ${engineLabel}`;
  }
  if (els.ocrPaneEyebrow) {
    els.ocrPaneEyebrow.textContent = result?.source === "bdrc" ? "BDRC OCR 结果" : "Gemini Vision OCR 结果";
  }
  els.ocrText.value = result?.text || "";
  els.ocrMeta.textContent = hasAiError
    ? "调用失败"
    : result?.text
    ? (isDirectTextSource(result.source) ? sourceLabel : "已识别")
    : "未识别";
  els.ocrMeta.style.color = hasAiError
    ? "var(--danger)"
    : result?.text
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
  const aiPending = Boolean(sourceCompare.llm.pending);
  const hasAiText = Boolean(aiText.trim());
  const hasAiError = Boolean(sourceCompare.llm.error || aiLines.some((line) => line.error));
  const returnedLineCount = sourceCompare.llm.returnedLineCount || countNonEmptyOcrLines(aiLines);
  const expectedLineCount = sourceCompare.llm.expectedLineCount || countNonEmptyOcrLines(bdrcLines);
  const model = sourceCompare.llm.model || "Gemini Vision";
  const lineMeta = expectedLineCount
    ? `${returnedLineCount}/${expectedLineCount} 行`
    : `${returnedLineCount} 行`;

  els.aiOcrTitle.textContent = state.pageCount ? `第 ${state.pageNum} 页 Gemini Vision` : "等待智能识别";
  els.aiOcrMeta.textContent = aiPending ? "识别中" : hasAiText ? `${model} · ${lineMeta}` : hasAiError ? "调用失败" : "未返回";
  els.aiOcrMeta.title = hasAiText
    ? `Gemini Vision 模型：${model}${sourceCompare.llm.provider ? `；服务：${sourceCompare.llm.provider}` : ""}；返回行数：${lineMeta}`
    : "";
  els.aiOcrMeta.style.color = aiPending
    ? "var(--amber)"
    : hasAiText
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

function getSourceHorizontalPadding(rawHeight) {
  return Math.max(14, Math.min(42, Number(rawHeight || 0) * 0.9));
}

function getSourceVerticalPadding(rawHeight) {
  return Math.max(6, Math.min(16, Number(rawHeight || 0) * 0.42));
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
  els.ocrButton.disabled = !hasDocument || state.isOcrBusy;
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
  if (state.batchOcr?.running) {
    [els.prevButton, els.nextButton, els.viewerFirstPageButton, els.viewerPrevPageButton,
      els.viewerNextPageButton, els.viewerLastPageButton, els.pageInput, els.viewerPageInput,
      els.ocrProfileSelect, els.ocrModeSelect, els.fileInput, els.folderInput].forEach((element) => {
      if (element) element.disabled = true;
    });
  } else {
    [els.ocrProfileSelect, els.ocrModeSelect, els.fileInput, els.folderInput].forEach((element) => {
      if (element) element.disabled = (element === els.ocrProfileSelect || element === els.ocrModeSelect) && state.isOcrBusy;
    });
  }
  updateBatchOcrProgress();
}

function syncPageControls(hasDocument = state.pageCount > 0) {
  const current = String(state.pageNum || 1);
  const max = String(state.pageCount || 1);
  [els.pageInput, els.viewerPageInput].forEach((input) => {
    if (!input) return;
    input.disabled = !hasDocument || Boolean(state.batchOcr?.running);
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
  const wasBusy = state.isOcrBusy;
  state.isOcrBusy = Boolean(isBusy);
  if (els.ocrModeSelect) els.ocrModeSelect.disabled = Boolean(isBusy);
  if (els.ocrProfileSelect) els.ocrProfileSelect.disabled = Boolean(isBusy);
  els.ocrButton.disabled = isBusy || !state.pageCount;
  setOptionalDisabled("checkOcrButton", isBusy);
  els.ocrButton.querySelector("span").textContent = isBusy ? "识别中" : "识别";
  if (wasBusy && !isBusy && state.ocrResults.get(state.pageNum)?.raw?.line_ocr) updateOcrPanelForPage();
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
      return `无法连接 ${url}。请先启动本地 Gemini Vision OCR 服务：python3 tibetan-ocr-core/ai_vision_ocr_server.py；或运行 ./tibetan-proofreading-app/start_services.sh`;
    }
    return `无法连接 ${url}。请先启动 Gemini Vision OCR 服务：python3 tibetan-ocr-core/ai_vision_ocr_server.py`;
  }
  return summarizeServiceError(error?.message || String(error));
}

function summarizeServiceError(message) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text) return "未知错误";
  if (text.includes("RESOURCE_EXHAUSTED") || text.includes("Quota exceeded") || text.includes("HTTP 429")) {
    const retryMatch = text.match(/retry in ([0-9.]+)s/i);
    const retry = retryMatch ? `，建议 ${Math.ceil(Number(retryMatch[1]))} 秒后重试` : "";
    return `上游模型额度或频率限制耗尽（HTTP 429 / RESOURCE_EXHAUSTED）${retry}。请更换可用的 Gemini Vision 模型/API key，或稍后重试。`;
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
