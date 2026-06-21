from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from common.config import AppConfig, ModelConfig, env_list, env_value, normalize_provider
from adapter_server.models import find_model


class ProviderError(RuntimeError):
    pass


@dataclass(slots=True)
class RuntimeProvider:
    id: str
    type: str
    base_url: str
    api_key: str = ""
    api_keys: list[str] | None = None
    chat_path: str = "/chat/completions"
    timeout_seconds: float = 120.0


def _join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _path_candidates(path: str | None, fallback: str) -> list[str]:
    paths = [path or fallback, fallback]
    if fallback.startswith("/v1/"):
        paths.append(fallback.removeprefix("/v1"))
    return list(dict.fromkeys(item for item in paths if item))


def _provider_from_model(config: AppConfig, model: ModelConfig) -> RuntimeProvider:
    provider_type = normalize_provider(model.provider)
    base_url = model.base_url or env_value(model.base_url_env)
    api_key = model.api_key or env_value(model.api_key_env)
    api_keys = model.api_keys or env_list(model.api_keys_env) or ([api_key] if api_key else [])
    chat_path = model.chat_path or env_value(model.chat_path_env) or "/chat/completions"
    timeout_seconds = model.timeout_seconds or 120.0

    for provider in config.adapter.providers:
        if provider.id != model.provider:
            continue
        provider_type = provider.type
        base_url = base_url or provider.base_url
        api_key = api_key or provider.api_key or ""
        api_keys = api_keys or provider.api_keys or ([api_key] if api_key else [])
        chat_path = model.chat_path or env_value(model.chat_path_env) or provider.chat_path
        timeout_seconds = model.timeout_seconds or provider.timeout_seconds
        break

    return RuntimeProvider(
        id=model.provider,
        type=provider_type,
        base_url=(base_url or "").rstrip("/"),
        api_key=api_key or "",
        api_keys=api_keys,
        chat_path=chat_path,
        timeout_seconds=timeout_seconds,
    )


def normalize_messages(payload: dict[str, Any]) -> list[dict[str, str]]:
    messages = payload.get("messages")
    if isinstance(messages, list) and messages:
        normalized: list[dict[str, str]] = []
        for item in messages:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "user")
            content = item.get("content")
            if isinstance(content, list):
                parts = []
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        parts.append(str(part.get("text") or ""))
                    elif isinstance(part, str):
                        parts.append(part)
                content_text = "\n".join(parts)
            else:
                content_text = str(content or "")
            normalized.append({"role": role, "content": content_text})
        if normalized:
            return normalized

    system = payload.get("system") or payload.get("system_prompt") or payload.get("prompt_system")
    prompt = (
        payload.get("prompt")
        or payload.get("text")
        or payload.get("source_text")
        or payload.get("input")
        or payload.get("content")
        or payload.get("query")
    )

    messages_out: list[dict[str, str]] = []
    if system:
        messages_out.append({"role": "system", "content": str(system)})
    messages_out.append({"role": "user", "content": str(prompt or "")})
    return messages_out


def extract_model_id(payload: dict[str, Any]) -> str | None:
    return (
        payload.get("model")
        or payload.get("model_id")
        or payload.get("matched_model_id")
        or payload.get("model_preference")
    )


async def call_openai_compatible(
    provider: RuntimeProvider,
    model: ModelConfig,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if not provider.base_url:
        raise ProviderError(f"Model {model.id} is missing base_url")

    headers = {"Content-Type": "application/json"}
    if provider.api_key:
        headers["Authorization"] = f"Bearer {provider.api_key}"

    upstream_payload: dict[str, Any] = {
        "model": model.upstream_model,
        "messages": normalize_messages(payload),
        "stream": False,
    }
    for key in ("temperature", "top_p", "max_tokens", "presence_penalty", "frequency_penalty"):
        if key in payload and payload[key] is not None:
            upstream_payload[key] = payload[key]

    errors: list[str] = []
    data: dict[str, Any] | None = None
    timeout = httpx.Timeout(provider.timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout) as client:
        for path in _path_candidates(provider.chat_path, "/v1/chat/completions"):
            response = await client.post(_join_url(provider.base_url, path), headers=headers, json=upstream_payload)
            if response.status_code >= 400:
                errors.append(f"{path} -> HTTP {response.status_code}: {response.text[:500]}")
                if response.status_code not in {404, 405}:
                    break
                continue
            data = response.json()
            break
    if data is None:
        raise ProviderError("；".join(errors) or "Provider request failed")

    content = ""
    try:
        content = data["choices"][0]["message"]["content"] or ""
    except Exception:
        content = data.get("text") or data.get("content") or ""
    return {
        "text": content,
        "content": content,
        "translation": content,
        "message": {"role": "assistant", "content": content},
        "choices": data.get("choices", [{"message": {"role": "assistant", "content": content}}]),
        "usage": data.get("usage", {}),
        "provider_response": data,
    }


async def call_gemini(provider: RuntimeProvider, model: ModelConfig, payload: dict[str, Any]) -> dict[str, Any]:
    if not provider.base_url:
        raise ProviderError(f"Gemini model {model.id} is missing base_url")
    api_keys = provider.api_keys or ([provider.api_key] if provider.api_key else [])
    if not api_keys:
        raise ProviderError(f"Gemini model {model.id} is missing api_keys")

    messages = normalize_messages(payload)
    system_parts: list[str] = []
    contents: list[dict[str, Any]] = []
    for message in messages:
        if message["role"] == "system":
            system_parts.append(message["content"])
            continue
        contents.append(
            {
                "role": "model" if message["role"] == "assistant" else "user",
                "parts": [{"text": message["content"]}],
            }
        )

    request_body: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {"temperature": payload.get("temperature", 0.2)},
    }
    if system_parts:
        request_body["systemInstruction"] = {"parts": [{"text": "\n\n".join(system_parts)}]}
    if payload.get("max_tokens") is not None:
        request_body["generationConfig"]["maxOutputTokens"] = int(payload["max_tokens"])

    encoded_model = quote((model.upstream_model or model.id).removeprefix("models/"), safe="")
    errors: list[str] = []
    timeout = httpx.Timeout(provider.timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout) as client:
        for index, api_key in enumerate(api_keys, start=1):
            url = f"{provider.base_url.rstrip('/')}/v1beta/models/{encoded_model}:generateContent?key={quote(api_key)}"
            response = await client.post(url, headers={"Content-Type": "application/json"}, json=request_body)
            if response.status_code >= 400:
                errors.append(f"key#{index} -> HTTP {response.status_code}: {response.text[:500]}")
                if response.status_code not in {401, 403, 429, 500, 502, 503, 504}:
                    break
                continue
            data = response.json()
            candidates = data.get("candidates") or []
            candidate = candidates[0] if candidates else {}
            parts = candidate.get("content", {}).get("parts", []) if isinstance(candidate, dict) else []
            content = "\n".join(
                str(part.get("text") or "").strip()
                for part in parts
                if isinstance(part, dict) and str(part.get("text") or "").strip()
            ).strip()
            if not content:
                errors.append(f"key#{index} -> empty response")
                continue
            usage = data.get("usageMetadata") or {}
            return {
                "text": content,
                "content": content,
                "translation": content,
                "message": {"role": "assistant", "content": content},
                "choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": candidate.get("finishReason")}],
                "usage": {
                    "prompt_tokens": usage.get("promptTokenCount"),
                    "completion_tokens": usage.get("candidatesTokenCount"),
                    "total_tokens": usage.get("totalTokenCount"),
                },
                "provider_response": data,
            }

    raise ProviderError("；".join(errors) or "Gemini request failed")


async def generate_text(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
    model = find_model(config, extract_model_id(payload))
    provider = _provider_from_model(config, model)
    if provider.type == "gemini":
        return await call_gemini(provider, model, payload)
    if provider.type != "openai_compatible":
        raise ProviderError(f"Unsupported provider type: {provider.type}")
    return await call_openai_compatible(provider, model, payload)
