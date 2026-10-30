(function (root) {
  'use strict';
  const MODEL = 'gemini:gemini-4-argon';
  function validateReview(payload, expectedRows) {
    if (payload?.model !== MODEL || payload?.recognition_scope !== 'whole-page') {
      throw new Error('返回的模型身份或识别范围不符');
    }
    if (!Array.isArray(payload.lines) || payload.lines.length !== expectedRows.length) {
      throw new Error('Gemini 返回行数与原图定位行数不符');
    }
    const byIndex = new Map(payload.lines.map(row => [row.index, row]));
    if (byIndex.size !== expectedRows.length) throw new Error('Gemini 返回重复行号');
    return expectedRows.map(row => {
      const found = byIndex.get(row.index);
      if (!found || typeof found.text !== 'string' || !found.text.trim()) {
        throw new Error(`Gemini 未返回第 ${row.index + 1} 行文本`);
      }
      return { index: row.index, bbox: row.bbox, text: found.text };
    });
  }
  function exportText(results, pageCount) {
    const parts = ['Gemini 4 藏文逐页识别结果', ''];
    for (let page = 1; page <= pageCount; page++) {
      const result = results.get(page);
      if (result) parts.push(`第 ${page} 页`, result.lines.map(line => line.text).join('\n'), '');
      else parts.push(`第 ${page} 页（未识别）`, '');
    }
    return parts.join('\n');
  }
  function parseExportText(source, pageCount) {
    const text = String(source || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!text.startsWith('Gemini 4 藏文逐页识别结果\n')) throw new Error('请选择此页面导出的 Gemini 4 识别 TXT。');
    const pages = [...text.matchAll(/^第 (\d+) 页(（未识别）)?$/gm)];
    if (pages.length !== pageCount) throw new Error('TXT 页数与当前 PDF 不一致。');
    const restored = new Map();
    for (let i = 0; i < pages.length; i++) {
      const [marker, number, missing] = pages[i];
      if (Number(number) !== i + 1) throw new Error('TXT 页码与当前 PDF 不一致。');
      const end = i + 1 < pages.length ? pages[i + 1].index : text.length;
      const body = text.slice(pages[i].index + marker.length, end).replace(/^\n/, '').replace(/\n+$/, '');
      if (missing) {
        if (body.trim()) throw new Error(`TXT 第 ${number} 页标记为未识别，却含有文本。`);
      } else {
        if (!body.trim()) throw new Error(`TXT 第 ${number} 页识别文本为空。`);
        restored.set(Number(number), { model: MODEL, lines: body.split('\n').map(text => ({ text })) });
      }
    }
    return restored;
  }
  function remainingPages(results, pageCount) {
    return Array.from({ length: pageCount }, (_, index) => index + 1).filter(page => !results.has(page));
  }
  function saveResults(storage, key, results, pageCount) {
    storage.setItem(key, exportText(results, pageCount));
  }
  function loadSavedResults(storage, key, pageCount) {
    const saved = storage.getItem(key);
    return saved ? parseExportText(saved, pageCount) : new Map();
  }
  const api = { validateReview, exportText, parseExportText, remainingPages, saveResults, loadSavedResults };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.document) return;
  const $ = id => root.document.getElementById(id);
  let pdf = null, results = new Map(), current = 1, busy = false, stopped = false, cacheKey = '', cacheAvailable = true;
  function status(message, error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
  function persistResults() {
    try { saveResults(root.localStorage, cacheKey, results, pdf.numPages); cacheAvailable = true; }
    catch { cacheAvailable = false; }
  }
  function show() {
    const count = pdf?.numPages || 0;
    $('pageNumber').textContent = count ? `${current} / ${count}` : '未加载 PDF';
    $('previous').disabled = !count || current <= 1 || busy;
    $('next').disabled = !count || current >= count || busy;
    $('runRemaining').disabled = !count || busy || remainingPages(results, count).length === 0;
    $('recognizedText').value = results.get(current)?.lines.map(x => x.text).join('\n') || '';
    $('recognitionMeta').textContent = results.has(current) ? `已识别 ${results.get(current).lines.length} 行 · ${MODEL}` : '本页尚未重新识别';
  }
  async function renderPage(number, forOcr = false) {
    const page = await pdf.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 2200 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = forOcr ? root.document.createElement('canvas') : $('pageCanvas');
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    if (!forOcr) return null;
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('原图渲染失败')), 'image/png'));
  }
  async function post(path, blob, fields = {}) {
    const form = new FormData(); form.append('file', blob, `page-${current}.png`);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    const response = await fetch(`http://127.0.0.1:18180${path}`, { method: 'POST', body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `${path}: HTTP ${response.status}`);
    return data;
  }
  async function recognize(number) {
    const blob = await renderPage(number, true);
    const layout = await post('/line-layout', blob);
    const rows = (layout.lines || []).flatMap((line, index) => line.region_id === 'center' && line.bbox
      ? [{ index, bbox: line.bbox, region_id: 'center' }] : []);
    if (!rows.length) throw new Error('中间栏行定位失败');
    const response = await post('/gemini-page-review', blob, { rows: JSON.stringify(rows), model: 'gemini-4-argon' });
    const lines = validateReview(response, rows);
    results.set(number, { model: MODEL, lines });
    persistResults();
    show();
  }
  async function loadPdf(file) {
    if (!file) return;
    if (!root.pdfjsLib) throw new Error('PDF 渲染库未加载');
    root.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
    const bytes = new Uint8Array(await file.arrayBuffer());
    pdf = await root.pdfjsLib.getDocument({ data: bytes }).promise;
    cacheKey = `gemini4-page-results:${pdf.fingerprints?.[0] || `${file.name}:${file.size}:${file.lastModified}`}`;
    try { results = loadSavedResults(root.localStorage, cacheKey, pdf.numPages); cacheAvailable = true; }
    catch { results = new Map(); cacheAvailable = false; }
    current = 1; show(); await renderPage(current);
    status(`已加载 ${pdf.numPages} 页 PDF，自动恢复 ${results.size} 页。${cacheAvailable ? '可识别剩余页。' : '自动保存不可用，请及时导出 TXT。'}`);
  }
  $('pdfFile').addEventListener('change', async e => { try { await loadPdf(e.target.files[0]); } catch (err) { status(err.message, true); } });
  $('resumeFile').addEventListener('change', async e => {
    try {
      if (!pdf) throw new Error('请先加载与 TXT 对应的 PDF。');
      const restored = parseExportText(await e.target.files[0].text(), pdf.numPages);
      for (const [page, result] of restored) if (!results.has(page)) results.set(page, result);
      persistResults(); show();
      status(`已恢复 ${results.size} / ${pdf.numPages} 页识别结果，可点击“识别剩余页”。${cacheAvailable ? '结果已自动保存。' : '自动保存不可用，请及时导出 TXT。'}`);
    } catch (err) { status(err.message, true); }
    finally { e.target.value = ''; }
  });
  for (const [id, delta] of [['previous', -1], ['next', 1]]) $(id).addEventListener('click', async () => {
    current += delta; show(); try { await renderPage(current); } catch (err) { status(err.message, true); }
  });
  $('runPage').addEventListener('click', async () => {
    if (!pdf || busy) return; busy = true; show();
    try { status(`第 ${current} 页识别中…`); await recognize(current); status(`第 ${current} 页识别完成。${cacheAvailable ? '已自动保存。' : '请及时导出 TXT。'}`); }
    catch (err) { status(`第 ${current} 页失败：${err.message}`, true); }
    finally { busy = false; show(); }
  });
  async function runBatch(onlyRemaining) {
    if (!pdf || busy) return;
    const pages = onlyRemaining ? remainingPages(results, pdf.numPages) : Array.from({ length: pdf.numPages }, (_, index) => index + 1);
    if (!pages.length) { status('全部页已识别，可导出 TXT。'); return; }
    busy = true; stopped = false; show();
    try {
      for (const page of pages) {
        if (stopped) break;
        current = page; show(); await renderPage(page); status(`正在识别第 ${page} / ${pdf.numPages} 页…`);
        try { await recognize(page); } catch (err) { status(`第 ${page} 页失败：${err.message}`, true); return; }
      }
      status(stopped ? '已停止；已完成的页可导出。' : `已完成 ${results.size} 页识别。`);
    } catch (err) { status(err.message, true); }
    finally { busy = false; show(); }
  }
  $('runAll').addEventListener('click', () => runBatch(false));
  $('runRemaining').addEventListener('click', () => runBatch(true));
  $('stop').addEventListener('click', () => { stopped = true; status('当前页请求结束后停止。'); });
  $('export').addEventListener('click', () => {
    if (!pdf) { status('请先加载 PDF。', true); return; }
    const blob = new Blob([exportText(results, pdf.numPages)], { type: 'text/plain;charset=utf-8' });
    const link = root.document.createElement('a'); link.href = URL.createObjectURL(blob);
    link.download = 'Gemini-4-逐页识别结果.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    status(`已导出；其中 ${results.size} / ${pdf.numPages} 页已识别。`);
  });
  show();
})(typeof window !== 'undefined' ? window : globalThis);
