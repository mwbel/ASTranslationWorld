from __future__ import annotations

import importlib
import os
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from common.config import load_config
from common.redaction import redact_obj


ROOT = Path(__file__).parents[1]


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


def main() -> int:
    tests = [test_redaction, test_config, test_univmodel_style_config, test_probe, test_adapter_login_and_models]
    for test in tests:
        test()
        print(f"ok {test.__name__}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
