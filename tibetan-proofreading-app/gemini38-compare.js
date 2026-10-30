(function (root) {
  'use strict';
  const MODEL = 'gemini:gemini-4-argon';
  function parseReference(markdown) {
    const source = String(markdown || '').replace(/^\uFEFF/, '');
    const marks = [...source.matchAll(/^## 第 (\d+) 页\s*$/gm)];
    const pages = new Map();
    for (let i = 0; i < marks.length; i++) {
      const page = Number(marks[i][1]);
      const body = source.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : source.length);
      const match = body.match(/^### (?:正确校对文本|当前采用的校对文本)\s*\n+~~~text\n([\s\S]*?)\n~~~\s*$/m);
      if (!match || pages.has(page)) throw new Error(`第 ${page} 页的校对文本缺失或重复`);
      pages.set(page, match[1]);
    }
    if (!pages.size) throw new Error('未找到带页码的校对文本');
    return pages;
  }
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
  function fence(text) {
    const longest = Math.max(0, ...[...String(text).matchAll(/~+/g)].map(m => m[0].length));
    return '~'.repeat(Math.max(3, longest + 1));
  }
  function section(label, text) {
    const marker = fence(text);
    return `### ${label}\n\n${marker}text\n${text}\n${marker}`;
  }
  function exportMarkdown(results, reference, pageCount) {
    const parts = ['# Gemini 4 藏文整页识别与校对对照', ''];
    for (let page = 1; page <= pageCount; page++) {
      const result = results.get(page);
      parts.push(`## 第 ${page} 页`, '', `识别模型：${result?.model || MODEL}`, '',
        section('Gemini 4 识别结果', result ? result.lines.map(line => line.text).join('\n') : ''), '',
        section('正确校对文本', reference.get(page) || ''), '');
    }
    return parts.join('\n');
  }
  const api = { parseReference, validateReview, exportMarkdown };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.document) return;
  const $ = id => root.document.getElementById(id);
  let pdf = null, reference = new Map(), results = new Map(), current = 1, busy = false, stopped = false;
  function status(message, error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
  function show() {
    const count = pdf?.numPages || 0;
    $('pageNumber').textContent = count ? `${current} / ${count}` : '未加载 PDF';
    $('previous').disabled = !count || current <= 1 || busy;
    $('next').disabled = !count || current >= count || busy;
    $('referenceText').value = reference.get(current) || '';
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
    show();
  }
  async function loadPdf(file) {
    if (!file) return;
    if (!root.pdfjsLib) throw new Error('PDF 渲染库未加载');
    root.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
    const bytes = new Uint8Array(await file.arrayBuffer());
    pdf = await root.pdfjsLib.getDocument({ data: bytes }).promise;
    current = 1; results = new Map(); show(); await renderPage(current);
    status(`已加载 ${pdf.numPages} 页 PDF。请选择校对稿，然后开始识别。`);
  }
  $('pdfFile').addEventListener('change', async e => { try { await loadPdf(e.target.files[0]); } catch (err) { status(err.message, true); } });
  $('referenceFile').addEventListener('change', async e => {
    try { reference = parseReference(await e.target.files[0].text()); show(); status(`已导入 ${reference.size} 页校对文本。`); }
    catch (err) { status(err.message, true); }
  });
  for (const [id, delta] of [['previous', -1], ['next', 1]]) $(id).addEventListener('click', async () => {
    current += delta; show(); try { await renderPage(current); } catch (err) { status(err.message, true); }
  });
  $('runPage').addEventListener('click', async () => {
    if (!pdf || busy) return; busy = true; show();
    try { status(`第 ${current} 页识别中…`); await recognize(current); status(`第 ${current} 页识别完成。`); }
    catch (err) { status(`第 ${current} 页失败：${err.message}`, true); }
    finally { busy = false; show(); }
  });
  $('runAll').addEventListener('click', async () => {
    if (!pdf || busy) return; busy = true; stopped = false; show();
    try {
      for (let page = 1; page <= pdf.numPages && !stopped; page++) {
        current = page; show(); await renderPage(page); status(`正在识别第 ${page} / ${pdf.numPages} 页…`);
        try { await recognize(page); } catch (err) { status(`第 ${page} 页失败：${err.message}`, true); return; }
      }
      status(stopped ? '已停止；已完成的页可导出。' : `已完成 ${results.size} 页识别。`);
    } catch (err) { status(err.message, true); }
    finally { busy = false; show(); }
  });
  $('stop').addEventListener('click', () => { stopped = true; status('当前页请求结束后停止。'); });
  $('export').addEventListener('click', () => {
    if (!pdf) { status('请先加载 PDF。', true); return; }
    const blob = new Blob([exportMarkdown(results, reference, pdf.numPages)], { type: 'text/markdown;charset=utf-8' });
    const link = root.document.createElement('a'); link.href = URL.createObjectURL(blob);
    link.download = 'Gemini-4-整页识别与校对对照.md'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    status(`已导出；其中 ${results.size} / ${pdf.numPages} 页已识别。`);
  });
  show();
})(typeof window !== 'undefined' ? window : globalThis);
