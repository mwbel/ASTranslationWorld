import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const ai = readFileSync(new URL("../../tibetan-ocr-core/ai_vision_ocr_server.py", import.meta.url), "utf8");

assert.match(app, /const ACTIVE_PROJECT_KEY = "tibetan-proofreading-app:active-project";/);
assert.match(app, /localStorage\.setItem\(ACTIVE_PROJECT_KEY, state\.cacheKey\)/);
assert.match(app, /async function restoreActiveProjectForRoute\(workflow\)/);
assert.match(app, /await loadFile\(sourceFile\);/);
assert.match(app, /ocrResults: serializeResultMap\(state\.ocrResults\)/);
assert.match(app, /sourceFile cache is lost|源文件缓存已丢失/);

assert.match(app, /const padY = Math\.max\(16, rawHeight \* 0\.75\)/);
assert.match(app, /const targetHeight = clamp\(96 \+ rawHeight \* 0\.35, 112, 180\)/);
assert.match(ai, /Keep the full vertically padded bbox|Keep the full vertically padded bbox/);

console.log("OCR persistence and adaptive line-height regression check passed");
