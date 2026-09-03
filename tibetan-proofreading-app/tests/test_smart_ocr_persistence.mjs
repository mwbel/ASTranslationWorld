import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const testFile = fileURLToPath(import.meta.url);
const appPath = new URL("../app.js", import.meta.url);
const source = readFileSync(appPath, "utf8");

const smartBranchStart = source.indexOf("const bdrcText = bdrcParsed.text.trim();");
const aiRequestStart = source.indexOf("setStatus(\"BDRC 完成，正在调用 AI Vision 校正高危藏文字母...\", \"warn\");", smartBranchStart);
const pendingPersistStart = source.indexOf("aiPending: true", smartBranchStart);

assert.notEqual(smartBranchStart, -1, "smart OCR branch must exist");
assert.notEqual(aiRequestStart, -1, "smart OCR branch must call AI Vision after BDRC");
assert.notEqual(pendingPersistStart, -1, "BDRC result must be persisted before the AI Vision request");
assert.ok(
  pendingPersistStart < aiRequestStart,
  "BDRC result must be cached and rendered before awaiting AI Vision"
);
assert.match(
  source,
  /AI Vision 正在识别/,
  "pending AI Vision state must be rendered instead of clearing both OCR panels"
);

const replaceDecisionStart = source.indexOf("function shouldReplaceExistingWithPdfText");
const replaceDecisionEnd = source.indexOf("function discardCurrentBadPdfTextResult", replaceDecisionStart);
const replaceDecision = source.slice(replaceDecisionStart, replaceDecisionEnd);

assert.notEqual(replaceDecisionStart, -1, "PDF text-layer replacement guard must exist");
assert.match(
  replaceDecision,
  /if \(!existingText\) return true;/,
  "PDF text extraction must populate an empty page"
);
assert.doesNotMatch(
  replaceDecision,
  /return !isDirectTextSource\(/,
  "PDF text extraction must not overwrite persisted BDRC/AI OCR results"
);

const pdfTextGuardStart = source.indexOf("function isUsablePdfDirectText");
const pdfTextGuardEnd = source.indexOf("function groupPdfTextItemsIntoLines", pdfTextGuardStart);
const pdfTextGuard = source.slice(pdfTextGuardStart, pdfTextGuardEnd);

assert.notEqual(pdfTextGuardStart, -1, "PDF text-layer quality guard must exist");
assert.match(
  pdfTextGuard,
  /tibetanRatio >= 0\.5/,
  "Tibetan PDF text layers must be Tibetan-dominant before they are treated as usable text"
);
assert.match(
  pdfTextGuard,
  /latinExtendedCount >= 4/,
  "Latin-extended mojibake must cause a Tibetan PDF text layer to be rejected"
);

console.log("smart OCR persistence regression check passed");
