import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function setup() {
  const storage = new Map();
  const document = {
    querySelector: () => null,
    createElement: () => ({
      dataset: {}, handlers: {},
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, handler) { this.handlers[name] = handler; },
    }),
  };
  const ctx = vm.createContext({console, document, window: {
    addEventListener() {},
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
  }});
  vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(`
    state.cacheKey = 'model-controls'; state.pageNum = 1; state.pageCount = 2;
    state.ocrResults.set(1, {source:'proofread', text:'ཀྱི', lines:[], compare:{
      bdrc:{text:'ཀྱི',lines:[{text:'ཀྱི'}]}, llm:{text:'མི',lines:[{text:'མི'}]},
      sharedErrors:[], qwenReviews:[{index:0,text:'བོད',errorRanges:[{start:0,end:2}]}],
      openaiReviews:[{index:0,text:'ཆོ',errorRanges:[{start:0,end:2}]}],
    }});
    renderCurrentOcrView = updateOcrPanelForPage = renderHomeDashboard = scheduleRemoteStateSave = () => {};
    updateSummary = updateTranslationSummary = () => {};
    setStatus = message => { window.lastStatus = message; };
  `, ctx);
  return ctx;
}

test('each model has an independent collapse control that survives rerender', () => {
  const ctx = setup();
  const result = vm.runInContext(`(() => {
    const bdrc = {hidden:false}; const gemini = {hidden:false};
    const bdrcButton = makeProofreadModelToggle(0, 'bdrc', bdrc);
    const geminiButton = makeProofreadModelToggle(0, 'llm', gemini);
    bdrcButton.handlers.click({stopPropagation(){}});
    const reopened = {hidden:false};
    makeProofreadModelToggle(0, 'bdrc', reopened);
    return {bdrc:bdrc.hidden,gemini:gemini.hidden,reopened:reopened.hidden,
      expanded:bdrcButton['aria-expanded']};
  })()`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {bdrc:true,gemini:false,reopened:true,expanded:'false'});
});

test('a model mark button rejects a selection from another model', () => {
  const ctx = setup();
  vm.runInContext(`
    getSelectedProofreadRange = () => ({side:'llm',index:0,start:0,end:2});
    markSelectedSharedError(0, {}, 'bdrc');
  `, ctx);
  assert.equal(vm.runInContext('state.ocrResults.get(1).compare.sharedErrors.length', ctx), 0);
  assert.match(ctx.window.lastStatus, /BDRC/);
});

test('clearing one model without a selection leaves other model errors intact', () => {
  const ctx = setup();
  vm.runInContext(`
    const c = state.ocrResults.get(1).compare;
    c.sharedErrors = [
      {blockIndex:0,bdrcRanges:[{start:0,end:2}],llmRanges:[]},
      {blockIndex:0,bdrcRanges:[],llmRanges:[{start:0,end:2}]},
    ];
    getSelectedProofreadRange = () => null;
    clearSharedErrorMark(0, {}, 'qwen');
  `, ctx);
  assert.equal(vm.runInContext('state.ocrResults.get(1).compare.qwenReviews[0].errorRanges.length', ctx), 0);
  assert.equal(vm.runInContext('state.ocrResults.get(1).compare.openaiReviews[0].errorRanges.length', ctx), 1);
  assert.equal(vm.runInContext('state.ocrResults.get(1).compare.sharedErrors.length', ctx), 2);
  vm.runInContext("clearSharedErrorMark(0, {}, 'bdrc')", ctx);
  assert.equal(vm.runInContext('state.ocrResults.get(1).compare.sharedErrors.length', ctx), 1);
  assert.equal(vm.runInContext('state.ocrResults.get(1).compare.sharedErrors[0].llmRanges.length', ctx), 1);
});
