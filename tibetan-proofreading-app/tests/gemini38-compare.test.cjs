const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { validateReview, exportText } = require('../gemini38-compare.js');

test('recognition page needs only a PDF and shows no reference comparison', () => {
  const html = readFileSync(join(__dirname, '../gemini38-compare.html'), 'utf8');
  assert.match(html, /id="pdfFile"/);
  assert.match(html, /id="export">导出识别 TXT/);
  assert.doesNotMatch(html, /referenceFile|referenceText|正确校对/);
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
