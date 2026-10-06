import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../../tibetan-ocr-core/bdrc_ocr_server.py", import.meta.url), "utf8");
const startScript = readFileSync(new URL("../start_services.sh", import.meta.url), "utf8");

for (const value of ["handwritten", "traditional", "modern"]) {
  assert.match(html, new RegExp(`value=\\"${value}\\"`), `${value} profile must be selectable`);
}
assert.match(html, /value="traditional" selected/, "traditional scripture layout must be the safe default for the attached source");
assert.match(app, /model: "Ume_Petsuk"/, "handwritten OCR must use the Ume_Petsuk model");
assert.match(app, /model: "Woodblock-Stacks"/, "traditional scripture OCR must use the Woodblock-Stacks model");
assert.match(app, /model: "Modern"/, "modern print OCR must use the Modern model");
assert.match(app, /ocr_profile: profile\.id/, "the selected profile must be sent to the OCR endpoint");
assert.match(app, /bdrc_model: profile\.model/, "the selected BDRC model must be sent to the OCR endpoint");
assert.match(app, /fetchOcrWithTransientRetry\(endpoint, formData, fields\.engine === "ai_vision"\)/, "AI Vision requests must use transient retry handling");
assert.match(app, /const maxRetries = retryTransient \? 3 : 0/, "transient retry handling must be limited to AI Vision");
assert.match(app, /message\.includes\("failed to fetch"\)/, "connection failures must be recognized as retryable");
assert.match(server, /OCR_PROFILES = \{/,'the BDRC service must define server-side profile mappings');
assert.match(server, /form\.getfirst\("ocr_profile"/, "the BDRC service must read the selected profile");
assert.match(server, /run_ocr\(image_bytes, profile_id, model_name, line_mode\)/, "the BDRC service must resolve the selected model per request");
assert.match(server, /region_order.*left.*center.*right/s, "traditional OCR must expose a stable left-center-right order");
assert.match(server, /run_traditional_region_ocr/, "traditional OCR must structure the three semantic regions");
assert.match(server, /ROTATE_90_CLOCKWISE/, "vertical side regions must have a rotated OCR path");
assert.match(app, /CANONICAL_REGION_ORDER = Object\.freeze\(\["left", "center", "right"\]\)/, "the frontend must define the canonical region order");
assert.match(app, /canonicalRegions = CANONICAL_REGION_ORDER\.map/, "the frontend must restore missing or shuffled regions");
assert.match(app, /regionLineCount/, "the frontend must show the line count inside each semantic region");
assert.match(app, /function normalizeOcrRegions\(regions\)/, "the frontend must preserve structured OCR regions");
assert.match(startScript, /start_service \\\n+  bdrc/, "the standard startup script must start the BDRC service");

console.log("OCR profile selection regression check passed");
