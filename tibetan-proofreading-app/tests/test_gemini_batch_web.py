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
