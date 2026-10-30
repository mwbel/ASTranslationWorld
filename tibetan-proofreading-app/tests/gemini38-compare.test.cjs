const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { validateReview, exportText, parseExportText, remainingPages, saveResults, loadSavedResults } = require('../gemini38-compare.js');

test('recognition page needs only a PDF and shows no reference comparison', () => {
  const html = readFileSync(join(__dirname, '../gemini38-compare.html'), 'utf8');
  assert.match(html, /id="pdfFile"/);
  assert.match(html, /id="resumeFile"/);
  assert.match(html, /id="runRemaining">识别剩余页/);
  assert.match(html, /id="export">导出识别 TXT/);
  assert.doesNotMatch(html, /referenceFile|referenceText|正确校对/);
});

test('imports a partial TXT export and resumes only missing pages', () => {
  const partial = exportText(new Map([
    [1, { lines: [{ text: 'ཀ' }] }],
    [3, { lines: [{ text: 'ག' }] }],
  ]), 4);
  const restored = parseExportText(partial, 4);
  assert.equal(restored.get(1).lines[0].text, 'ཀ');
  assert.equal(restored.get(3).lines[0].text, 'ག');
  assert.deepEqual(remainingPages(restored, 4), [2, 4]);
  assert.throws(() => parseExportText(partial, 3), /页数|页码/);
});

test('saves recognized pages and restores them after a page reload', () => {
  const items = new Map();
  const storage = {
    getItem: key => items.get(key) || null,
    setItem: (key, value) => items.set(key, value),
  };
  const key = 'gemini4-results:pdf-fingerprint';
  const results = new Map([[1, { lines: [{ text: 'ཀ' }] }]]);
  saveResults(storage, key, results, 2);
  const restored = loadSavedResults(storage, key, 2);
  assert.equal(restored.get(1).lines[0].text, 'ཀ');
  assert.deepEqual(remainingPages(restored, 2), [2]);
  assert.equal(loadSavedResults(storage, 'gemini4-results:another-pdf', 2).size, 0);
});

test('rejects missing rows and wrong model before accepting OCR', () => {
  const expected = [{ index: 0 }, { index: 1 }];
  assert.throws(() => validateReview({ model: 'gemini:other', recognition_scope: 'whole-page', lines: [{ index: 0, text: 'ཀ' }, { index: 1, text: 'ཁ' }] }, expected));
  assert.throws(() => validateReview({ model: 'gemini:gemini-3.8-flash', recognition_scope: 'whole-page', lines: [{ index: 0, text: 'ཀ' }, { index: 1, text: 'ཁ' }] }, expected));
  assert.throws(() => validateReview({ model: 'gemini:gemini-4-argon', recognition_scope: 'whole-page', lines: [{ index: 0, text: 'ཀ' }] }, expected));
  assert.deepEqual(validateReview({ model: 'gemini:gemini-4-argon', recognition_scope: 'whole-page', lines: [{ index: 1, text: 'ཁ' }, { index: 0, text: 'ཀ' }] }, expected).map(x => x.text), ['ཀ', 'ཁ']);
});

test('exports recognized text in page order and marks pages not yet recognized', () => {
  const out = exportText(new Map([
    [2, { lines: [{ text: 'ཁ' }, { text: 'ག' }] }],
    [1, { lines: [{ text: 'ཀ' }] }],
  ]), 3);
  assert.equal(out, 'Gemini 4 藏文逐页识别结果\n\n第 1 页\nཀ\n\n第 2 页\nཁ\nག\n\n第 3 页（未识别）\n');
  assert.doesNotMatch(out, /正确校对文本|~~~|```/);
});
