from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from adapter_server.models import find_model
from adapter_server.providers import _coerce_literal_items, _prepare_messages_for_provider
from common.config import load_config
from common.redaction import redact_obj


def test_redaction_masks_sensitive_nested_values() -> None:
    value = {
        "password": "super-secret",
        "nested": {"api_key": "sk-abcdef123456", "safe": "visible"},
    }
    redacted = redact_obj(value)
    assert redacted["password"] != "super-secret"
    assert redacted["nested"]["api_key"] != "sk-abcdef123456"
    assert redacted["nested"]["safe"] == "visible"


def test_config_loads_example() -> None:
    cfg = load_config(ROOT / "examples" / "config.example.yaml")
    assert cfg.adapter.users[0].username == "demo"
    assert cfg.adapter.models[0].id == "local-qwen"
    assert cfg.adapter.models[0].provider == "local-openai"


def test_find_model_matches_alias() -> None:
    cfg = load_config(ROOT / "config.yaml")
    resolved = find_model(cfg, "gemini-3-flash-preview")
    assert resolved.id == "agg-local-qwen25"


def test_literal_json_coercion_keeps_only_requested_token_id() -> None:
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


def test_config_loads_univmodel_style() -> None:
    cfg = load_config(ROOT / "examples" / "univmodel-style.config.yaml")
    assert cfg.adapter.models[0].provider == "openai-compatible"
    assert cfg.adapter.models[0].upstream_model == "qwen3.6-27b:latest"
    assert "reasoning" in cfg.adapter.models[0].capabilities
    assert cfg.adapter.models[2].provider == "gemini"


def test_probe_health_and_capture(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("PROBE_DATA_DIR", str(tmp_path / "probe"))
    import importlib
    import probe_server.app as probe_app

    importlib.reload(probe_app)
    client = TestClient(probe_app.app)
    assert client.get("/health").status_code == 200
    res = client.post("/some/login", json={"username": "demo", "password": "demo-password"})
    assert res.status_code == 200
    assert (tmp_path / "probe" / "requests.jsonl").exists()


def test_adapter_login_and_models(monkeypatch) -> None:
    monkeypatch.setenv("ADAPTER_CONFIG", str(ROOT / "examples" / "config.example.yaml"))
    import importlib
    import adapter_server.app as adapter_app

    importlib.reload(adapter_app)
    client = TestClient(adapter_app.app)
    login = client.post("/auth/login", json={"username": "demo", "password": "demo-password", "reseller_code": "demo"})
    assert login.status_code == 200
    token = login.json()["token"]
    models = client.get("/models", headers={"Authorization": f"Bearer {token}"})
    assert models.status_code == 200
    assert models.json()["total"] == 2


def test_adapter_streams_openai_compatible_chunks(monkeypatch) -> None:
    monkeypatch.setenv("ADAPTER_CONFIG", str(ROOT / "examples" / "config.example.yaml"))
    import importlib
    import adapter_server.app as adapter_app

    importlib.reload(adapter_app)

    async def fake_generate_text(_cfg, _payload):
        return {
            "content": "stream ok",
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        }

    monkeypatch.setattr(adapter_app, "generate_text", fake_generate_text)
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
