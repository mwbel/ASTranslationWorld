from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator


def normalize_provider(value: str) -> str:
    normalized = (value or "").strip().lower().replace("-", "_")
    aliases = {
        "local": "openai_compatible",
        "openai": "openai_compatible",
        "openai_compatible": "openai_compatible",
        "yunwu": "openai_compatible",
        "yunwu_openai": "openai_compatible",
        "yunwu_gpt55": "openai_compatible",
        "gemini": "gemini",
        "google_gemini": "gemini",
        "ollama": "ollama",
    }
    return aliases.get(normalized, normalized or "openai_compatible")


def split_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    if not text:
        return []
    return [item.strip() for item in text.split(",") if item.strip()]


def env_value(name: str | None) -> str:
    return os.getenv(str(name or "").strip(), "").strip()


def env_list(name: str | None) -> list[str]:
    return split_list(env_value(name))


def infer_capabilities(model: str, provider: str, configured: list[str] | None = None) -> list[str]:
    lowered = (model or "").lower()
    provider = normalize_provider(provider)
    capabilities = {item.strip() for item in configured or [] if item.strip()}

    if any(token in lowered for token in ("embed", "embedding", "nomic-embed")):
        capabilities.add("embedding")
        return sorted(capabilities)

    capabilities.update({"chat", "chinese"})

    if any(token in lowered for token in ("qwen", "deepseek", "gpt", "gemini", "claude", "yi", "glm")):
        capabilities.update({"reasoning", "rag_synthesis"})

    if any(token in lowered for token in ("math", "qwen", "deepseek", "gpt", "gemini", "reason")):
        capabilities.add("math")

    if any(token in lowered for token in ("long", "128k", "32k", "gpt-5", "gpt-4", "gemini", "pro")):
        capabilities.add("long_context")

    if provider == "gemini":
        capabilities.update({"reasoning", "rag_synthesis", "long_context"})

    return sorted(capabilities)


class UserConfig(BaseModel):
    username: str
    password: str | None = None
    password_hash: str | None = None
    reseller_code: str | None = None
    allowed_models: list[str] = Field(default_factory=list)


class ProviderConfig(BaseModel):
    id: str
    type: str = "openai_compatible"
    base_url: str = ""
    api_key: str | None = None
    api_keys: list[str] = Field(default_factory=list)
    chat_path: str = "/chat/completions"
    timeout_seconds: float = 120.0

    @model_validator(mode="after")
    def normalize(self) -> "ProviderConfig":
        self.type = normalize_provider(self.type)
        self.api_keys = self.api_keys or ([self.api_key] if self.api_key else [])
        return self


class ModelConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    provider: str = "openai_compatible"
    display_name: str | None = None
    upstream_model: str | None = None
    source_model: str | None = Field(default=None, alias="model")
    model_env: str | None = None
    category: str = "quality_translation"
    supports_stream: bool = True
    supports_vision: bool = False
    context_window: int | None = None
    base_url: str | None = None
    base_url_env: str | None = None
    api_key: str | None = None
    api_key_env: str | None = None
    api_keys: list[str] = Field(default_factory=list)
    api_keys_env: str | None = None
    chat_path: str | None = None
    chat_path_env: str | None = None
    capabilities: list[str] = Field(default_factory=list)
    privacy: str = "remote"
    cost: str = "unknown"
    latency: str = "medium"
    priority: int = 50
    enabled: bool = True
    source: str = "configured"
    timeout_seconds: float | None = None

    @model_validator(mode="after")
    def normalize(self) -> "ModelConfig":
        if not self.upstream_model:
            self.upstream_model = self.source_model or env_value(self.model_env) or self.id
        if not self.display_name:
            self.display_name = self.id
        self.api_keys = self.api_keys or ([self.api_key] if self.api_key else [])
        self.capabilities = infer_capabilities(self.upstream_model, self.provider, self.capabilities)
        if any(item in self.capabilities for item in ("vision", "ocr", "multimodal")):
            self.supports_vision = True
        return self


class AdapterConfig(BaseModel):
    users: list[UserConfig] = Field(default_factory=list)
    providers: list[ProviderConfig] = Field(default_factory=list)
    models: list[ModelConfig] = Field(default_factory=list)


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 18081
    data_dir: str = "data"


class AppConfig(BaseModel):
    server: ServerConfig = Field(default_factory=ServerConfig)
    adapter: AdapterConfig = Field(default_factory=AdapterConfig)


def load_config(path: str | Path) -> AppConfig:
    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")
    raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    normalized: dict[str, Any] = {
        "server": raw.get("server", {}),
        "adapter": {
            "users": raw.get("auth", {}).get("users", raw.get("users", [])),
            "providers": raw.get("providers", []),
            "models": raw.get("models", []),
        },
    }
    return AppConfig.model_validate(normalized)
