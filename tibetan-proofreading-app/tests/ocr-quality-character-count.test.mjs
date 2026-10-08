import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({
  console,
  window: {addEventListener() {}},
  document: {querySelector: () => null},
});
vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), context);

test('one marked Tibetan stacked glyph counts as one error', () => {
  const stats = vm.runInContext(`getLineQualityStats(
    {text:'ཀྱིམ'},
    {sharedErrors:[{blockIndex:0,llmRanges:[{start:0,end:3}]}]},
    'llm', 0
  )`, context);
  assert.equal(stats.totalChars, 2);
  assert.equal(stats.errorChars, 1);
  assert.equal(stats.errorRate, 0.5);
});

test('overlapping marks on one glyph do not double count, adjacent glyphs do', () => {
  assert.equal(vm.runInContext("countErrorRanges('ཀྱིམ',[{start:0,end:2},{start:1,end:3}])", context), 1);
  assert.equal(vm.runInContext("countErrorRanges('ཀྱིམ',[{start:0,end:4}])", context), 2);
});

test('saved OCR quality uses the same visible character units as the line header', () => {
  const saved = vm.runInContext(`(() => {
    const compare = {llm:{model:'test',provider:'gemini'},sharedErrors:[
      {blockIndex:0,llmRanges:[{start:0,end:3}]}
    ]};
    state.ocrQualityReviews = [];
    saveOcrQualityReview({result:{},compare,pageNum:1,blockIndex:0,text:'ཀྱིམ'});
    return state.ocrQualityReviews[0];
  })()`, context);
  assert.equal(saved.reviewedChars, 2);
  assert.equal(saved.errorChars, 1);
});

test('changing one stacked glyph counts as one manual edit', () => {
  const edited = vm.runInContext(`updateManualEditTracking({}, 'ཀྱེམ', 'ཀྱིམ')`, context);
  assert.equal(edited.manualErrorChars, 1);
});
