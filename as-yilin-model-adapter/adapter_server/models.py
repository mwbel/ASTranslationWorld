from __future__ import annotations

from typing import Any

from common.config import AppConfig, ModelConfig, UserConfig


def user_can_use_model(user: UserConfig | None, model: ModelConfig) -> bool:
    if not model.enabled:
        return False
    if user is None:
        return True
    return not user.allowed_models or model.id in user.allowed_models


def model_to_wire(model: ModelConfig) -> dict[str, Any]:
    return {
        "id": model.id,
        "model_id": model.id,
        "name": model.display_name or model.id,
        "display_name": model.display_name or model.id,
        "label": model.display_name or model.id,
        "matched_model_id": model.id,
        "model_category": model.category,
        "category": model.category,
        "supports_stream": model.supports_stream,
        "supports_vision": model.supports_vision,
        "is_vision": model.supports_vision,
        "context_window": model.context_window,
        "provider": model.provider,
        "upstream_model": model.upstream_model,
        "aliases": model.aliases,
        "capabilities": model.capabilities,
        "privacy": model.privacy,
        "cost": model.cost,
        "latency": model.latency,
        "priority": model.priority,
        "enabled": model.enabled,
        "configured": True,
        "source": model.source,
    }


def list_models(config: AppConfig, user: UserConfig | None = None) -> list[dict[str, Any]]:
    return [model_to_wire(model) for model in config.adapter.models if user_can_use_model(user, model)]


def model_response(models: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "models": models,
        "data": models,
        "items": models,
        "total": len(models),
    }


def find_model(config: AppConfig, model_id: str | None) -> ModelConfig:
    if model_id:
        for model in config.adapter.models:
            if not model.enabled:
                continue
            aliases = set(model.aliases or [])
            if model.id == model_id or model.upstream_model == model_id or model_id in aliases:
                return model
    for model in config.adapter.models:
        if model.enabled:
            return model
    raise ValueError("No adapter models configured")
