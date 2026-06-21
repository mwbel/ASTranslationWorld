from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

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
    cfg = load_config(Path(__file__).parents[1] / "examples" / "config.example.yaml")
    assert cfg.adapter.users[0].username == "demo"
    assert cfg.adapter.models[0].id == "local-qwen"
    assert cfg.adapter.models[0].provider == "local-openai"


def test_config_loads_univmodel_style() -> None:
    cfg = load_config(Path(__file__).parents[1] / "examples" / "univmodel-style.config.yaml")
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
    monkeypatch.setenv("ADAPTER_CONFIG", str(Path(__file__).parents[1] / "examples" / "config.example.yaml"))
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
