import base64
import http.client
import json
import os
import sys
import tempfile
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from gemini_batch_web import BatchPageHandler, LocalBatchStore, configure_api_key  # noqa: E402


JPEG_BYTES = b"\xff\xd8\xff" + b"sample-page" + b"\xff\xd9"


class LocalBatchStoreTests(unittest.TestCase):
    def test_existing_key_pool_is_used_without_exposing_key(self):
        with tempfile.TemporaryDirectory() as temp:
            pool = Path(temp) / ".env"
            pool.write_text('GEMINI_API_KEYS="secret-one,secret-two"\n', encoding="utf-8")
            with patch.dict(os.environ, {"GEMINI_API_KEY": "", "GEMINI_API_KEYS": ""}):
                source = configure_api_key(pool)
                self.assertEqual(os.environ["GEMINI_API_KEY"], "secret-one")
                self.assertNotIn("secret-one", source)

    def test_prepare_persists_one_page_request_without_network(self):
        with tempfile.TemporaryDirectory() as temp:
            store = LocalBatchStore(Path(temp))
            job = store.create({"title": "1.pdf", "prompt": "识别藏文", "model": "gemini-4-argon", "expected_pages": 1})
            page = store.add_page(job["id"], {
                "page": 1, "mime_type": "image/jpeg", "data": base64.b64encode(JPEG_BYTES).decode("ascii"),
            })
            self.assertEqual(page["uploaded_pages"], 1)
            result = store.prepare(job["id"])
            self.assertEqual(result["count"], 1)
            row = json.loads(store.download_path(job["id"], "input").read_text(encoding="utf-8"))
            self.assertEqual(row["key"], "page-0001")
            self.assertEqual(row["request"]["contents"][0]["parts"][0]["text"], "识别藏文")
            with self.assertRaisesRegex(Exception, "不能再修改页图"):
                store.add_page(job["id"], {"page": 1, "mime_type": "image/jpeg", "data": base64.b64encode(JPEG_BYTES).decode("ascii")})

    def test_prepare_rejects_missing_pages(self):
        with tempfile.TemporaryDirectory() as temp:
            store = LocalBatchStore(Path(temp))
            job = store.create({"title": "book", "prompt": "OCR", "expected_pages": 2})
            store.add_page(job["id"], {"page": 1, "mime_type": "image/jpeg", "data": base64.b64encode(JPEG_BYTES).decode("ascii")})
            with self.assertRaisesRegex(Exception, "第 2 页"):
                store.prepare(job["id"])

    def test_completed_pages_survive_failure_and_only_failed_page_retries(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            store = LocalBatchStore(root)
            job = store.create({"title": "ten pages", "prompt": "OCR", "expected_pages": 10})
            for page in range(1, 11):
                store.add_page(job["id"], {
                    "page": page, "mime_type": "image/jpeg",
                    "data": base64.b64encode(JPEG_BYTES).decode("ascii"),
                })
            self.assertEqual(store.prepare(job["id"])["count"], 10)
            self.assertEqual(len(list((root / job["id"] / "batch_pages").glob("*/input.jsonl"))), 10)

            submitted = []

            def fake_submit(input_path, state_path, *, model, display_name):
                page = int(Path(input_path).parent.name.split("-")[1])
                attempt = int(Path(state_path).parent.name.split("-")[1])
                submitted.append((page, attempt))
                state = {"job_name": f"batches/{page}-{attempt}", "state": "JOB_STATE_PENDING"}
                Path(state_path).write_text(json.dumps(state), encoding="utf-8")
                return state

            def fake_status(state_path):
                state = json.loads(Path(state_path).read_text(encoding="utf-8"))
                page, attempt = map(int, state["job_name"].split("/")[1].split("-"))
                state["state"] = "JOB_STATE_FAILED" if page == 9 and attempt == 1 else "JOB_STATE_SUCCEEDED"
                return state

            def fake_download(state_path, *, output_jsonl, output_text):
                state = json.loads(Path(state_path).read_text(encoding="utf-8"))
                page = int(state["job_name"].split("/")[1].split("-")[0])
                key = f"page-{page:04d}"
                row = {"key": key, "response": {"candidates": [{"content": {"parts": [{"text": f"text {page}"}]}}]}}
                Path(output_jsonl).write_text(json.dumps(row) + "\n", encoding="utf-8")
                Path(output_text).write_text(f"第 {page} 页\ntext {page}\n", encoding="utf-8")
                return [{"key": key, "text": f"text {page}", "error": None}]

            with patch("gemini_batch_web.submit_batch", side_effect=fake_submit), \
                 patch("gemini_batch_web.check_status", side_effect=fake_status), \
                 patch("gemini_batch_web.download_results", side_effect=fake_download):
                store.submit(job["id"])
                for _ in range(4):
                    store.process_once()
                checkpoint = store.describe(job["id"])["checkpoint"]
                self.assertEqual((checkpoint["saved"], checkpoint["failed"]), (9, 1))
                before = store.download_path(job["id"], "txt").read_text(encoding="utf-8")
                self.assertIn("第 1 页\ntext 1", before)
                self.assertIn("第 10 页\ntext 10", before)
                self.assertNotIn("第 9 页", before)
                self.assertEqual(len(submitted), 10)

                restarted = LocalBatchStore(root)
                self.assertEqual(restarted.describe(job["id"])["checkpoint"]["saved"], 9)
                workflow = restarted._workflow(root / job["id"])
                workflow["pages"]["1"]["status"] = "submitted"
                restarted._write_workflow(root / job["id"], workflow)
                restarted.download_path(job["id"], "txt").unlink()
                restarted.process_once()
                self.assertEqual(restarted.download_path(job["id"], "txt").read_text(encoding="utf-8"), before)
                self.assertEqual(restarted.retry_failed(job["id"])["retried"], 1)
                restarted.process_once()
                restarted.process_once()
                self.assertEqual(restarted.describe(job["id"])["checkpoint"]["saved"], 10)
                self.assertEqual(len(submitted), 11)
                self.assertEqual(submitted[-1], (9, 2))
                after = restarted.download_path(job["id"], "txt").read_text(encoding="utf-8")
                self.assertIn(before, after.replace("第 9 页\ntext 9\n\n", ""))

    def test_unknown_submission_is_not_retried_automatically(self):
        with tempfile.TemporaryDirectory() as temp:
            store = LocalBatchStore(Path(temp))
            job = store.create({"title": "book", "prompt": "OCR", "expected_pages": 1})
            store.add_page(job["id"], {"page": 1, "mime_type": "image/jpeg", "data": base64.b64encode(JPEG_BYTES).decode("ascii")})
            store.prepare(job["id"])
            with patch("gemini_batch_web.submit_batch", side_effect=TimeoutError("network")) as submit:
                store.submit(job["id"])
                store.process_once()
                store.process_once()
                self.assertEqual(submit.call_count, 1)
            self.assertEqual(store.describe(job["id"])["checkpoint"]["review"], 1)
            with self.assertRaisesRegex(Exception, "没有可安全重试"):
                store.retry_failed(job["id"])


class LocalHttpTests(unittest.TestCase):
    def test_mutation_requires_local_page_header(self):
        with tempfile.TemporaryDirectory() as temp:
            store = LocalBatchStore(Path(temp))
            server = ThreadingHTTPServer(("127.0.0.1", 0), partial(BatchPageHandler, store=store))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
                payload = json.dumps({"title": "book", "prompt": "OCR", "expected_pages": 1})
                connection.request("POST", "/api/jobs", payload, {"Content-Type": "application/json"})
                rejected = connection.getresponse()
                self.assertEqual(rejected.status, 403)
                rejected.read()
                connection.request("POST", "/api/jobs", payload, {
                    "Content-Type": "application/json", "X-Gemini-Batch-UI": "1",
                })
                accepted = connection.getresponse()
                self.assertEqual(accepted.status, 201)
                self.assertIn("job", json.loads(accepted.read()))
                connection.close()
            finally:
                server.shutdown()
                server.server_close()


if __name__ == "__main__":
    unittest.main()
