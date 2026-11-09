import base64
import json
import tempfile
import unittest
from pathlib import Path
import sys

TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS_DIR))

import gemini_batch_ocr as batch  # noqa: E402


class PrepareJsonlTests(unittest.TestCase):
    def test_images_directory_generates_api_jsonl_in_natural_page_order(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            images = root / "images"
            images.mkdir()
            (images / "page-10.png").write_bytes(b"ten")
            (images / "page-2.png").write_bytes(b"two")
            prompt = root / "prompt.txt"
            prompt.write_text("Transcribe Tibetan.", encoding="utf-8")
            output = root / "input.jsonl"

            count = batch.prepare_jsonl(images_dir=images, prompt_file=prompt, output=output, temperature=0.1)

            self.assertEqual(count, 2)
            rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
            self.assertEqual([row["key"] for row in rows], ["page-0001", "page-0002"])
            parts = rows[0]["request"]["contents"][0]["parts"]
            self.assertEqual(parts[0]["text"], "Transcribe Tibetan.")
            self.assertEqual(parts[1]["inlineData"]["mimeType"], "image/png")
            self.assertEqual(base64.b64decode(parts[1]["inlineData"]["data"]), b"two")
            self.assertEqual(rows[0]["request"]["generationConfig"]["temperature"], 0.1)

    def test_manifest_supports_image_and_translation_text_rows(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "page.png").write_bytes(b"image")
            manifest = root / "manifest.jsonl"
            manifest.write_text(
                json.dumps({"key": "page-1", "image": "page.png", "prompt": "OCR"}, ensure_ascii=False) + "\n"
                + json.dumps({"key": "page-2", "text": "བོད་ཡིག", "prompt": "Translate"}, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            output = root / "input.jsonl"

            self.assertEqual(batch.prepare_jsonl(manifest=manifest, output=output), 2)
            rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(rows[0]["request"]["contents"][0]["parts"][0]["text"], "OCR")
            self.assertEqual(rows[1]["request"]["contents"][0]["parts"], [{"text": "Translate"}, {"text": "བོད་ཡིག"}])

    def test_duplicate_keys_and_missing_prompt_are_rejected_without_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest = root / "manifest.jsonl"
            manifest.write_text('{"key":"same","text":"ཀ","prompt":"P"}\n{"key":"same","text":"ཁ","prompt":"P"}\n', encoding="utf-8")
            output = root / "input.jsonl"
            with self.assertRaisesRegex(batch.BatchToolError, "key 重复"):
                batch.prepare_jsonl(manifest=manifest, output=output)
            self.assertFalse(output.exists())

            manifest.write_text('{"key":"missing-prompt","text":"ཀ"}\n', encoding="utf-8")
            with self.assertRaisesRegex(batch.BatchToolError, "没有 prompt"):
                batch.prepare_jsonl(manifest=manifest, output=output)
            self.assertFalse(output.exists())

    def test_existing_output_is_not_overwritten_by_default(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            images = root / "images"
            images.mkdir()
            (images / "page.png").write_bytes(b"image")
            prompt = root / "prompt.txt"
            prompt.write_text("OCR", encoding="utf-8")
            output = root / "input.jsonl"
            output.write_text("keep", encoding="utf-8")
            with self.assertRaisesRegex(batch.BatchToolError, "已存在"):
                batch.prepare_jsonl(images_dir=images, prompt_file=prompt, output=output)
            self.assertEqual(output.read_text(encoding="utf-8"), "keep")


class ResultParsingTests(unittest.TestCase):
    def test_result_jsonl_preserves_keys_extracts_text_and_formats_pages(self):
        content = "\n".join([
            json.dumps({"key": "page-0002", "response": {"candidates": [{"content": {"parts": [{"text": "第二页"}]}}]}}),
            json.dumps({"key": "page-0001", "response": {"candidates": [{"content": {"parts": [{"text": "第一页"}]}}]}}),
            json.dumps({"key": "page-0003", "error": {"code": 429, "message": "quota"}}),
        ])
        rows = batch.parse_result_jsonl(content)
        self.assertEqual(rows[0]["text"], "第二页")
        self.assertIn("quota", rows[2]["error"])
        formatted = batch.render_text_results(rows)
        self.assertLess(formatted.index("第 1 页"), formatted.index("第 2 页"))
        self.assertIn("[识别失败]", formatted)

    def test_invalid_result_jsonl_is_reported(self):
        with self.assertRaisesRegex(batch.BatchToolError, "无法解析"):
            batch.parse_result_jsonl(b"not-json\n")


if __name__ == "__main__":
    unittest.main()
