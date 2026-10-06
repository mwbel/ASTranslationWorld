import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const storage = new Map();
const elements = [];
const ctx = vm.createContext({console, Event, window: {addEventListener() {}, localStorage: {
  getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
}}, document: {querySelector: () => null, createTextNode(text) {return {textContent:text};}, createElement() {
  const node = {children: [], dataset: {}, value: '', isConnected: true, handlers: {},
    append(...args) {this.children.push(...args);}, appendChild(arg) {this.children.push(arg);},
    replaceChildren() {this.children=[];}, setAttribute(name,value) {this[name]=value;},
    addEventListener(name, cb) {(this.handlers[name] ??= []).push(cb);},
    dispatchEvent(event) {for (const cb of this.handlers[event.type] || []) cb(event);}};
  elements.push(node); return node;
}}});
vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), ctx);
vm.runInContext(`
  state.pageNum=1; state.pageCount=2; state.cacheKey='test-qwen';
  state.ocrResults.set(1,{text:'original', lines:[{text:'original'}], source:'bdrc', compare:{
    bdrc:{text:'BDRC',lines:[{text:'BDRC'}]}, llm:{text:'Gemini',lines:[{text:'Gemini'}]},
    openaiReviews:[{index:0,text:'OpenAI',model:'test-openai'}]}});
  getAiVisionLineReviewEndpoint=()=> 'http://localhost/line-review';
  getCurrentPageImageBlob=async()=>({});
  callAiVisionLineReviewEndpoint=async(endpoint,blob,bbox,draft,model)=> {
    if(!endpoint.endsWith('/qwen-line-review') || draft!=='' || model!=='qwen3.7-plus') throw Error('bad provider/model routing');
    return {text:'བོད་',raw:{model:'qwen3.7-plus'}};
  };
  renderHomeDashboard=scheduleRemoteStateSave=updateOcrPanelForPage=()=>{};
  updateSummary=updateTranslationSummary=setStatus=()=>{};
  renderQwenLineReview(0,{bbox:{x:.1,y:.2,width:.4,height:.1}},null,null);
`,ctx);
const selector = elements.find(node => node['aria-label']?.includes('千问复核模型'));
selector.value = 'qwen3.7-plus';
selector.dispatchEvent(new Event('change'));
await elements.find(node => node.textContent === '千问 复核').handlers.click[0]({stopPropagation(){}});
const saved = JSON.parse(storage.get('test-qwen')).ocrResults['1'];
assert.equal(saved.text, 'original');
assert.equal(saved.compare.bdrc.text, 'BDRC');
assert.equal(saved.compare.llm.text, 'Gemini');
assert.equal(saved.compare.openaiReviews[0].text, 'OpenAI');
assert.equal(saved.compare.qwenReviews[0].model, 'qwen3.7-plus');
vm.runInContext('state.ocrResults.clear(); restoreCachedResults(); renderQwenLineReview(0,{bbox:{x:.1,y:.2,width:.4,height:.1}},null,null)',ctx);
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.qwenReviews[0].text',ctx), 'བོད་');
const selectors = elements.filter(node => node['aria-label']?.includes('千问复核模型'));
assert.equal(selectors.at(-1).value, 'qwen3.7-plus');
vm.runInContext("els.ocrText={value:''}; updateThumbnailState=()=>{}; saveProofreadBlockChoice(0,'qwen',null)",ctx);
assert.equal(vm.runInContext('state.ocrResults.get(1).text',ctx), 'བོད་');
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.llm.lines[0].provider',ctx), 'qwen');
assert.equal(vm.runInContext('getEffectiveOcrSideLines(state.ocrResults.get(1).compare.llm)[0].provider',ctx), 'qwen');
vm.runInContext('restoreCachedResults()',ctx);
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.llm.lines[0].provider',ctx), 'qwen');
console.log('Qwen model routing, independent cache, adoption and refresh passed');

assert.equal(vm.runInContext("validateIndependentReviewText('```text\\nབོད་\\n```')", ctx), 'བོད་');
assert.throws(() => vm.runInContext(`validateIndependentReviewText('{"vin码":"123"}')`, ctx));
vm.runInContext("updateIndependentReviewErrors('qwen',0,'བོད་',{start:0,end:2}); restoreCachedResults()",ctx);
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.qwenReviews[0].errorRanges[0].end',ctx),2);
assert.equal(vm.runInContext("updateIndependentReviewErrors('qwen',0,'stale',{start:0,end:1})",ctx),false);
vm.runInContext("updateIndependentReviewErrors('qwen',0,'བོད་',null); restoreCachedResults()",ctx);
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.qwenReviews[0].errorRanges.length',ctx),0);
console.log('Candidate error marks persist independently; unrelated output rejected');
vm.runInContext(`
  const candidateMarkup = document.createElement('div');
  renderOcrLineMarkup(candidateMarkup, 'སྐྱ་', {sharedErrorRanges:[{start:0,end:3}]});
  if(!candidateMarkup.children.some(node => node.className?.includes('ocr-risk-inline') && node.className?.includes('ocr-shared-error-inline'))) throw Error('stack and error highlights must coexist');
`,ctx);
console.log('Tibetan stacked-letter highlights coexist with candidate error marks');
vm.runInContext(`
  getSelectedProofreadRange=()=>({index:0,reviewProvider:'qwen',sourceText:'བོད་',start:0,end:2});
  markSelectedSharedError(0,{});
`,ctx);
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.qwenReviews[0].errorRanges[0].end',ctx),2);
vm.runInContext('clearSharedErrorMark(0,{})',ctx);
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.qwenReviews[0].errorRanges.length',ctx),0);
console.log('Shared mark/clear controls route candidate selections independently');
