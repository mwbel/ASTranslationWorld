(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OcrTbSegmentation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parsePagedOcrText(value) {
    const text = String(value || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
      .replace(/<\/?span\b[^>]*>/gi, '').trim();
    if (!text) return [];
    const lines = text.split('\n');
    const hasHeadings = lines.some((line) => /^第\s*\d+\s*页\s*$/.test(line.trim()));
    if (!hasHeadings) return [{ page: 1, text }];
    const pages = [];
    let page = null;
    let body = [];
    const flush = () => {
      const content = body.join('\n').trim();
      if (content) pages.push({ page: page || 1, text: content });
      body = [];
    };
    for (const line of lines) {
      const heading = /^第\s*(\d+)\s*页\s*$/.exec(line.trim());
      if (!heading) { body.push(line); continue; }
      flush();
      const nextPage = Number(heading[1]);
      if (!Number.isSafeInteger(nextPage) || nextPage < 1 || pages.some((item) => item.page === nextPage)) {
        throw new Error(`TXT 含重复或无效的第 ${heading[1]} 页标记`);
      }
      page = nextPage;
    }
    flush();
    return pages;
  }

  function proposeSegments(pages, options = {}) {
    const segments = [];
    const requestedLength = Number(options.minLength ?? 160);
    const minLength = Number.isFinite(requestedLength) ? Math.max(0, requestedLength) : 160;
    for (const item of pages || []) {
      const page = Number(item.page);
      if (!Number.isInteger(page) || page < 1) continue;
      const text = String(item.text || '').replace(/\r\n?/g, '\n').trim();
      if (!text) continue;
      for (const block of text.split(/\n\s*\n/)) {
        const candidates = [];
        const boundaries = /༎|།[ \t]*།/g;
        let start = 0;
        for (const match of block.matchAll(boundaries)) {
          const end = match.index + match[0].length;
          const part = cleanText(block.slice(start, end));
          if (part) candidates.push(part);
          start = end;
        }
        const rest = cleanText(block.slice(start));
        if (rest) candidates.push(rest);
        if (!minLength) {
          segments.push(...candidates.map((part) => ({ text: part, pages: [page] })));
          continue;
        }
        const pageSegments = [];
        let pending = '';
        for (const part of candidates) {
          pending = pending ? `${pending} ${part}` : part;
          if (pending.length >= minLength) { pageSegments.push(pending); pending = ''; }
        }
        if (pending) {
          if (pageSegments.length) pageSegments[pageSegments.length - 1] += ` ${pending}`;
          else pageSegments.push(pending);
        }
        segments.push(...pageSegments.map((part) => ({ text: part, pages: [page] })));
      }
    }
    return segments;
  }

  function mergeSegments(segments, index) {
    if (index < 0 || index >= segments.length - 1) throw new Error('没有可合并的下一段');
    const current = segments[index];
    const next = segments[index + 1];
    const merged = { text: cleanText(`${current.text} ${next.text}`),
      pages: [...new Set([...(current.pages || []), ...(next.pages || [])])].sort((a, b) => a - b) };
    return [...segments.slice(0, index), merged, ...segments.slice(index + 2)];
  }

  function splitSegment(segments, index, offset) {
    const item = segments[index];
    if (!item) throw new Error('段落不存在');
    const first = cleanText(item.text.slice(0, offset));
    const second = cleanText(item.text.slice(offset));
    if (!first || !second) throw new Error('请把光标放在段落中间再拆分');
    return [...segments.slice(0, index), { text: first, pages: [...item.pages] },
      { text: second, pages: [...item.pages] }, ...segments.slice(index + 1)];
  }

  function buildTbSource(segments, name) {
    if (!Array.isArray(segments) || !segments.length) throw new Error('没有可确认的段落');
    const sourcePages = {};
    const lines = segments.map((segment, index) => {
      const content = cleanText(segment.text);
      if (!content) throw new Error(`第 ${index + 1} 段是空段`);
      const pages = [...new Set(segment.pages || [])].sort((a, b) => a - b);
      if (!pages.length || pages.some((page) => !Number.isInteger(page) || page < 1)) throw new Error(`第 ${index + 1} 段缺少有效原页码`);
      const id = `TB-${String(index + 1).padStart(4, '0')}`;
      sourcePages[id] = pages;
      return `[${id}] ${content}`;
    });
    return { name: `${String(name || 'OCR 校对稿').replace(/\.[^.]+$/, '')}-TB编号.txt`,
      text: `${lines.join('\n')}\n`, source_pages: sourcePages };
  }

  return { parsePagedOcrText, proposeSegments, mergeSegments, splitSegment, buildTbSource };
});
