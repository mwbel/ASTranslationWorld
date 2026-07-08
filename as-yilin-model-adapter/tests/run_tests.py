from __future__ import annotations

import importlib
import os
import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from adapter_server.models import find_model
from adapter_server.providers import _coerce_literal_items, _prepare_messages_for_provider
from common.config import load_config
from common.redaction import redact_obj


def test_redaction() -> None:
    redacted = redact_obj({"password": "super-secret", "nested": {"api_key": "sk-abc", "safe": "visible"}})
    assert redacted["password"] != "super-secret"
    assert redacted["nested"]["api_key"] != "sk-abc"
    assert redacted["nested"]["safe"] == "visible"


def test_config() -> None:
    cfg = load_config(ROOT / "examples" / "config.example.yaml")
    assert cfg.adapter.users[0].username == "demo"
    assert cfg.adapter.models[0].id == "local-qwen"
    assert cfg.adapter.models[0].provider == "local-openai"


def test_find_model_alias() -> None:
    cfg = load_config(ROOT / "config.yaml")
    resolved = find_model(cfg, "gemini-3-flash-preview")
    assert resolved.id == "agg-local-qwen25"


def test_literal_json_coercion() -> None:
    token_id = "311ca66d-9e99-4ca6-a96f-5fd6cc87c085-t0"
    messages = _prepare_messages_for_provider(
        {
            "messages": [
                {
                    "role": "user",
                    "content": (
                        f'Output JSON for token_id. TOKENS: [{{"id":"{token_id}",'
                        '"text":"把地穴囚室比喻可见世界"}}]'
                    ),
                }
            ]
        }
    )
    content = '[{"token_id":"made-up-t0","literal":"bad"},{"token_id":"' + token_id + '","literal":"visible world",},]'
    coerced = _coerce_literal_items(content, messages)
    assert coerced == f'[{{"token_id":"{token_id}","literal":"visible world","alt":[],"note":""}}]'


def test_univmodel_style_config() -> None:
    cfg = load_config(ROOT / "examples" / "univmodel-style.config.yaml")
    assert cfg.adapter.models[0].provider == "openai-compatible"
    assert cfg.adapter.models[0].upstream_model == "qwen3.6-27b:latest"
    assert "reasoning" in cfg.adapter.models[0].capabilities
    assert cfg.adapter.models[2].provider == "gemini"


def test_probe() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["PROBE_DATA_DIR"] = str(Path(tmp) / "probe")
        import probe_server.app as probe_app

        importlib.reload(probe_app)
        client = TestClient(probe_app.app)
        assert client.get("/health").status_code == 200
        res = client.post("/some/login", json={"username": "demo", "password": "demo-password"})
        assert res.status_code == 200
        assert (Path(tmp) / "probe" / "requests.jsonl").exists()


def test_adapter_login_and_models() -> None:
    os.environ["ADAPTER_CONFIG"] = str(ROOT / "examples" / "config.example.yaml")
    import adapter_server.app as adapter_app

    importlib.reload(adapter_app)
    client = TestClient(adapter_app.app)
    login = client.post("/auth/login", json={"username": "demo", "password": "demo-password", "reseller_code": "demo"})
    assert login.status_code == 200
    token = login.json()["token"]
    models = client.get("/models", headers={"Authorization": f"Bearer {token}"})
    assert models.status_code == 200
    assert models.json()["total"] == 2


def test_adapter_streaming_chunks() -> None:
    os.environ["ADAPTER_CONFIG"] = str(ROOT / "examples" / "config.example.yaml")
    import adapter_server.app as adapter_app

    importlib.reload(adapter_app)

    async def fake_generate_text(_cfg, _payload):
        return {"content": "stream ok", "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}}

    adapter_app.generate_text = fake_generate_text
    client = TestClient(adapter_app.app)
    login = client.post("/auth/login", json={"username": "demo", "password": "demo-password", "reseller_code": "demo"})
    token = login.json()["token"]
    response = client.post(
        "/v1/chat/completions",
        headers={"Authorization": f"Bearer {token}"},
        json={"model": "local-qwen", "messages": [{"role": "user", "content": "hello"}], "stream": True},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert '"object": "chat.completion.chunk"' in response.text
    assert '"content": "stream ok"' in response.text
    assert "data: [DONE]" in response.text


def main() -> int:
    tests = [
        test_redaction,
        test_config,
        test_find_model_alias,
        test_literal_json_coercion,
        test_univmodel_style_config,
        test_probe,
        test_adapter_login_and_models,
        test_adapter_streaming_chunks,
    ]
    for test in tests:
        test()
        print(f"ok {test.__name__}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
