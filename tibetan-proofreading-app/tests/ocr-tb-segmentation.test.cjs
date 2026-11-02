const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../ocr-tb-segmentation.js');

test('proposes paragraphs from reviewed pages without splitting on every single shad', () => {
  const segments = core.proposeSegments([
    { page: 1, text: 'ཀ། ཁ། ། ག།\nང།' },
    { page: 2, text: 'ཅ། ཆ།' },
  ], { minLength: 0 });
  assert.deepEqual(segments, [
    { text: 'ཀ། ཁ། །', pages: [1] },
    { text: 'ག། ང།', pages: [1] },
    { text: 'ཅ། ཆ།', pages: [2] },
  ]);
});

test('default grouping keeps opening marker with text and combines short verses per original page', () => {
  const segments = core.proposeSegments([
    { page: 1, text: '༄༅། །ཀ། །ཁ། །ག། །ང། །' },
    { page: 2, text: 'ཅ། །ཆ། །' },
  ]);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, '༄༅། ། ཀ། ། ཁ། ། ག། ། ང། །');
  assert.deepEqual(segments.map((item) => item.pages), [[1], [2]]);
});

test('an existing blank-line paragraph boundary stays separate when grouping short text', () => {
  assert.deepEqual(core.proposeSegments([{ page: 1, text: 'ཀ།\n\nཁ།' }]), [
    { text: 'ཀ།', pages: [1] }, { text: 'ཁ།', pages: [1] },
  ]);
});

test('merge and split retain original page references and stable numbered output', () => {
  const merged = core.mergeSegments([
    { text: 'ཀ།', pages: [1] }, { text: 'ཁ། ག།', pages: [2] },
  ], 0);
  assert.deepEqual(merged, [{ text: 'ཀ། ཁ། ག།', pages: [1, 2] }]);
  const split = core.splitSegment(merged, 0, merged[0].text.indexOf('ཁ'));
  assert.equal(split.length, 2);
  assert.deepEqual(split.map((part) => part.pages), [[1, 2], [1, 2]]);
  const payload = core.buildTbSource(split, 'OCR 校对稿');
  assert.match(payload.text, /^\[TB-0001\] ཀ།\n\[TB-0002\] ཁ། ག།\n$/);
  assert.deepEqual(payload.source_pages, { 'TB-0001': [1, 2], 'TB-0002': [1, 2] });
});

test('empty reviewed pages cannot be confirmed as TB source', () => {
  assert.deepEqual(core.proposeSegments([{ page: 1, text: '' }]), []);
  assert.throws(() => core.buildTbSource([{ text: '  ', pages: [1] }], 'bad'), /空段/);
});

test('page-labeled OCR TXT becomes source pages without translating page headings', () => {
  const pages = core.parsePagedOcrText('第 1 页\nཀ། ཁ། །\n\n第 2 页\nག།\nང།\n');
  assert.deepEqual(pages, [
    { page: 1, text: 'ཀ། ཁ། །' },
    { page: 2, text: 'ག།\nང།' },
  ]);
  const source = core.buildTbSource(core.proposeSegments(pages), '校对结果.txt');
  assert.doesNotMatch(source.text, /第 [12] 页/);
  assert.deepEqual(source.source_pages, { 'TB-0001': [1], 'TB-0002': [2] });
});

test('plain unnumbered TXT is treated as one original page', () => {
  assert.deepEqual(core.parsePagedOcrText('ཀ།\nཁ།'), [{ page: 1, text: 'ཀ།\nཁ།' }]);
});

test('TXT proofreading color spans are removed while Tibetan text remains', () => {
  const pages = core.parsePagedOcrText('第 1 页\n<span style="color:red">ཐུགས་གཏེར་</span> ཟབ་མོ།');
  assert.deepEqual(pages, [{ page: 1, text: 'ཐུགས་གཏེར་ ཟབ་མོ།' }]);
});
