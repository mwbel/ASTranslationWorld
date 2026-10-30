const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseReference, validateReview, exportMarkdown } = require('../gemini38-compare.js');

test('imports the 24 page corrected Markdown without mixing page text', () => {
  const md = '## 第 1 页\n\n### 正确校对文本\n\n~~~text\n甲\n~~~\n\n## 第 2 页\n\n### 当前采用的校对文本\n\n~~~text\n乙\n~~~\n';
  const pages = parseReference(md);
  assert.equal(pages.get(1), '甲');
  assert.equal(pages.get(2), '乙');
});

test('rejects missing rows and wrong model before accepting OCR', () => {
  const expected = [{ index: 0 }, { index: 1 }];
  assert.throws(() => validateReview({ model: 'gemini:other', recognition_scope: 'whole-page', lines: [{ index: 0, text: 'ཀ' }, { index: 1, text: 'ཁ' }] }, expected));
  assert.throws(() => validateReview({ model: 'gemini:gemini-3.8-flash', recognition_scope: 'whole-page', lines: [{ index: 0, text: 'ཀ' }, { index: 1, text: 'ཁ' }] }, expected));
  assert.throws(() => validateReview({ model: 'gemini:gemini-4-argon', recognition_scope: 'whole-page', lines: [{ index: 0, text: 'ཀ' }] }, expected));
  assert.deepEqual(validateReview({ model: 'gemini:gemini-4-argon', recognition_scope: 'whole-page', lines: [{ index: 1, text: 'ཁ' }, { index: 0, text: 'ཀ' }] }, expected).map(x => x.text), ['ཀ', 'ཁ']);
});

test('exports recognition and reference as separate sections', () => {
  const out = exportMarkdown(new Map([[1, { lines: [{ text: 'ཀ' }], model: 'gemini:gemini-4-argon' }]]), new Map([[1, 'ཁ']]), 1);
  assert.match(out, /## 第 1 页[\s\S]*### Gemini 4 识别结果[\s\S]*ཀ[\s\S]*### 正确校对文本[\s\S]*ཁ/);
});
