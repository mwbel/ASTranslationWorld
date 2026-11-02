(() => {
  'use strict';
  const core = window.OcrTbSegmentation;
  const bookId = new URLSearchParams(location.search).get('book_id');
  const sourceMode = new URLSearchParams(location.search).get('source') === 'txt' ? 'txt' : 'ocr';
  const byId = (id) => document.getElementById(id);
  const draftKey = `ocr-tb-segmentation:${bookId}`;
  const localSourceKey = `ocr-tb-local-source:${bookId}`;
  const PAGE_SIZE = 25;
  let segments = [];
  let page = 1;
  let sourceName = '';
  let sourceSnapshot = '';
  let draftSnapshot = '';
  let localSource = null;
  try { localSource = JSON.parse(sessionStorage.getItem(localSourceKey) || 'null'); }
  catch (_) { /* A local file can be selected again. */ }
  const route = `./?workflow=translation&book_id=${encodeURIComponent(bookId || '')}`;

  function status(message, error = false) {
    byId('status').textContent = message;
    byId('status').classList.toggle('error', error);
  }

  async function getJson(path) {
    const response = await fetch(path, { credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.detail || `HTTP ${response.status}`), { status: response.status });
    return payload;
  }

  function reviewedPages(book) {
    const results = book.ocr_results || book.ocrResults || {};
    return Object.entries(results).map(([number, result]) => ({ page: Number(number), text: result?.text || '', source: result?.source || '' }))
      .filter((item) => Number.isInteger(item.page) && item.page > 0 && item.text.trim())
      .sort((a, b) => a.page - b.page);
  }

  async function readInputBook() {
    if (localSource?.text) {
      const pages = core.parsePagedOcrText(localSource.text);
      if (!pages.length) throw new Error('本地 TXT 没有可用的藏文正文');
      return { name: localSource.name, ocr_results: Object.fromEntries(
        pages.map(({ page, text }) => [page, { text, source: 'local-txt' }])) };
    }
    const book = await getJson(`/api/books/${bookId}/state`);
    if (sourceMode !== 'txt') return book;
    const response = await fetch(`/api/books/${bookId}/source`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取已上传 TXT 失败：HTTP ${response.status}`);
    const pages = core.parsePagedOcrText(await response.text());
    if (!pages.length) throw new Error('已上传 TXT 没有可用的藏文正文');
    return { ...book, ocr_results: Object.fromEntries(pages.map(({ page, text }) => [page, { text, source: 'imported-txt' }])) };
  }

  function saveDraft() {
    localStorage.setItem(draftKey, JSON.stringify({ sourceSnapshot: draftSnapshot, segments }));
  }

  function render() {
    const maxPage = Math.max(1, Math.ceil(segments.length / PAGE_SIZE));
    page = Math.max(1, Math.min(maxPage, page));
    byId('pageLabel').textContent = `第 ${page} / ${maxPage} 组 · 共 ${segments.length} 段`;
    byId('previousPageButton').disabled = page === 1;
    byId('nextPageButton').disabled = page === maxPage;
    const container = byId('segments');
    container.replaceChildren();
    segments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).forEach((segment, localIndex) => {
      const index = (page - 1) * PAGE_SIZE + localIndex;
      const card = document.createElement('section'); card.className = 'segment';
      const heading = document.createElement('div'); heading.className = 'segment-header';
      const label = document.createElement('strong'); label.textContent = `TB-${String(index + 1).padStart(4, '0')}`;
      const pages = document.createElement('label'); pages.textContent = '原页码 ';
      const pageInput = document.createElement('input'); pageInput.type = 'text'; pageInput.value = segment.pages.join(',');
      pageInput.size = Math.max(4, Math.min(18, pageInput.value.length + 1));
      pageInput.setAttribute('aria-label', `${label.textContent} 原页码，逗号分隔`);
      pageInput.addEventListener('change', () => {
        const entries = pageInput.value.split(/[,，、\s]+/).filter(Boolean);
        const parsed = entries.map(Number);
        if (!parsed.length || parsed.some((value) => !Number.isInteger(value) || value < 1)) {
          status('原页码须为正整数，多个页码用逗号分隔。', true); pageInput.value = segment.pages.join(','); return;
        }
        segment.pages = [...new Set(parsed)].sort((a, b) => a - b);
        pageInput.value = segment.pages.join(','); saveDraft();
      });
      pages.append(pageInput);
      heading.append(label, pages);
      const editor = document.createElement('textarea'); editor.value = segment.text;
      editor.setAttribute('aria-label', `${label.textContent} 藏文原文`);
      editor.addEventListener('input', () => { segment.text = editor.value; saveDraft(); });
      const actions = document.createElement('div'); actions.className = 'segment-actions';
      const split = document.createElement('button'); split.type = 'button'; split.textContent = '从光标处分段';
      split.addEventListener('click', () => {
        try { segments = core.splitSegment(segments, index, editor.selectionStart); saveDraft(); render(); status(`已拆分第 ${index + 1} 段，请核对两段原页码。`); }
        catch (error) { status(error.message, true); }
      });
      const merge = document.createElement('button'); merge.type = 'button'; merge.textContent = '与下一段合并'; merge.disabled = index === segments.length - 1;
      merge.addEventListener('click', () => {
        try { segments = core.mergeSegments(segments, index); saveDraft(); render(); status(`已合并第 ${index + 1} 段与下一段。`); }
        catch (error) { status(error.message, true); }
      });
      actions.append(split, merge); card.append(heading, editor, actions); container.append(card);
    });
  }

  function startFromBook(book) {
    const pages = reviewedPages(book);
    if (!pages.length) throw new Error('本书尚无 OCR 校对文本，请先返回校对页处理。');
    sourceName = book.sourceName || book.name || 'OCR 校对稿';
    sourceSnapshot = JSON.stringify(pages.map(({ page, text }) => ({ page, text })));
    const saved = JSON.parse(localStorage.getItem(draftKey) || 'null');
    const reused = saved && Array.isArray(saved.segments) && saved.segments.length;
    const changed = reused && saved.sourceSnapshot !== sourceSnapshot;
    draftSnapshot = reused ? saved.sourceSnapshot : sourceSnapshot;
    segments = reused ? saved.segments : core.proposeSegments(pages);
    if (!segments.length) throw new Error('校对稿没有可用的藏文原文');
    byId('sourceName').textContent = sourceName;
    const unfinished = pages.filter((item) => item.source !== 'proofread').length;
    byId('summary').textContent = `已有 ${pages.length} 页文字，自动划分 ${segments.length} 个候选段。${localSource ? '已从本地 TXT 读取原页码。' : sourceMode === 'txt' ? '已从上传的 TXT 读取原页码。' : unfinished ? `其中 ${unfinished} 页没有人工校对标记。` : '校对记录已读取。'}可按需调整段落和原页码。${reused ? ' 已恢复本机分段草稿。' : ''}${changed ? ' 校对原文已变化，请核对差异或点击重建候选。' : ''}`;
    byId('editor').hidden = false;
    render();
    status(changed ? '校对原文已变化；保留了旧分段草稿。请核对差异或重建候选。'
      : reused ? '已恢复上次分段草稿，可按需修改后采用。' : '自动分段初稿已生成，可直接采用或按需修改；采用前不会修改 TB 原文或译文。', changed);
  }

  async function confirmSource() {
    if (draftSnapshot !== sourceSnapshot) { status('校对原文已变化。请先重建候选，再核对和确认。', true); return; }
    let payload;
    try { payload = core.buildTbSource(segments, sourceName); }
    catch (error) { status(error.message, true); return; }
    const button = byId('confirmButton'); button.disabled = true;
    try {
      const latest = reviewedPages(await readInputBook());
      if (JSON.stringify(latest.map(({ page, text }) => ({ page, text }))) !== sourceSnapshot) {
        throw new Error('原文已变化，请重建候选段后再采用');
      }
      const response = await fetch(`/api/books/${bookId}/tb/source`, { method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
      localStorage.removeItem(draftKey);
      location.assign(route);
    } catch (error) { status(`关联 TB 原文失败：${error.message}`, true); button.disabled = false; }
  }

  async function init() {
    if (!/^[0-9a-f]{32}$/.test(bookId || '')) throw new Error('缺少有效的书籍 ID');
    byId('backLink').href = `./?workflow=ocr&book_id=${encodeURIComponent(bookId)}`;
    byId('translationLink').href = route;
    let existing;
    try { existing = await getJson(`/api/books/${bookId}/tb/source`); }
    catch (error) { if (error.status !== 404) throw error; }
    if (existing) {
      byId('existing').hidden = false;
      const heading = document.createElement('h2'); heading.textContent = '本书已关联 TB 编号原文';
      const detail = document.createElement('p'); detail.textContent = `${existing.name} · ${existing.segment_count} 段。已有编号与译文受到保护，不会从 OCR 稿覆盖。`;
      byId('existing').append(heading, detail);
      byId('translationLink').hidden = false;
      status('可直接继续 TB 段落翻译。');
      return;
    }
    startFromBook(await readInputBook());
  }

  byId('previousPageButton').addEventListener('click', () => { page -= 1; render(); scrollTo(0, 0); });
  byId('nextPageButton').addEventListener('click', () => { page += 1; render(); scrollTo(0, 0); });
  byId('rebuildButton').addEventListener('click', async () => {
    if (!window.confirm('从当前原文重建候选段落会丢弃本机分段草稿，继续吗？')) return;
    localStorage.removeItem(draftKey);
    try { startFromBook(await readInputBook()); }
    catch (error) { status(error.message, true); }
  });
  byId('localFileInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.txt$/i.test(file.name)) { status('请选择 TXT 文本文件。', true); return; }
    if (localStorage.getItem(draftKey) && !window.confirm('选择本地 TXT 会替换当前分段草稿，继续吗？')) return;
    try {
      const text = await file.text();
      if (!core.parsePagedOcrText(text).length) throw new Error('本地 TXT 没有可用的藏文正文');
      localSource = { name: file.name, text };
      localStorage.removeItem(draftKey);
      let sessionSaved = true;
      try { sessionStorage.setItem(localSourceKey, JSON.stringify(localSource)); }
      catch (_) { sessionSaved = false; }
      page = 1;
      startFromBook(await readInputBook());
      status(`已从本地打开 ${file.name}，请核对 ${segments.length} 个候选段。${sessionSaved ? '' : '浏览器未能缓存文件，刷新后需重新选择。'}`);
    } catch (error) { status(`本地 TXT 打开失败：${error.message || error}`, true); }
  });
  byId('confirmButton').addEventListener('click', () => void confirmSource());
  void init().catch((error) => status(error.message, true));
})();
