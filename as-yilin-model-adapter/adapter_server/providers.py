from __future__ import annotations

import asyncio
import copy
from dataclasses import dataclass
import json
from time import perf_counter
import re
from typing import Any
from urllib.parse import quote

import httpx

from common.config import AppConfig, ModelConfig, env_list, env_value, normalize_provider
from adapter_server.models import find_model, list_model_configs


class ProviderError(RuntimeError):
    pass


LITERAL_TOKEN_ID_RE = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-t\d+\b"
)


def _message_text(messages: list[dict[str, str]]) -> str:
    return "\n".join(message.get("content", "") for message in messages)


def _literal_token_ids(messages: list[dict[str, str]]) -> list[str]:
    seen: set[str] = set()
    token_ids: list[str] = []
    for token_id in LITERAL_TOKEN_ID_RE.findall(_message_text(messages)):
        if token_id in seen:
            continue
        seen.add(token_id)
        token_ids.append(token_id)
    return token_ids


def _looks_like_literal_request(messages: list[dict[str, str]]) -> bool:
    text = _message_text(messages).lower()
    return bool(_literal_token_ids(messages)) and "token_id" in text and "literal" in text


def _repair_json_array_text(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped, flags=re.IGNORECASE)
        stripped = re.sub(r"\s*```$", "", stripped)
    start = stripped.find("[")
    end = stripped.rfind("]")
    if start >= 0 and end > start:
        stripped = stripped[start : end + 1]
    stripped = re.sub(r",\s*([}\]])", r"\1", stripped)
    return stripped


def _coerce_literal_items(content: str, messages: list[dict[str, str]]) -> str:
    token_ids = _literal_token_ids(messages)
    if not token_ids:
        return content

    parsed: Any = None
    try:
        parsed = json.loads(_repair_json_array_text(content))
    except Exception:
        parsed = None

    if isinstance(parsed, dict):
        for key in ("items", "tokens", "literals", "entries", "translations"):
            if isinstance(parsed.get(key), list):
                parsed = parsed[key]
                break
    if not isinstance(parsed, list):
        parsed = []

    by_id: dict[str, dict[str, Any]] = {}
    loose_items: list[dict[str, Any]] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        raw_token_id = item.get("token_id") or item.get("source_token_id") or item.get("tid") or item.get("id")
        literal = item.get("literal") or item.get("literal_text") or item.get("translation") or item.get("text")
        if not isinstance(literal, str) or not literal.strip():
            continue
        normalized = {
            "token_id": str(raw_token_id or ""),
            "literal": literal.strip(),
            "alt": item.get("alt") if isinstance(item.get("alt"), list) else [],
            "note": item.get("note") if isinstance(item.get("note"), str) else "",
        }
        if normalized["token_id"] in token_ids and normalized["token_id"] not in by_id:
            by_id[normalized["token_id"]] = normalized
        else:
            loose_items.append(normalized)

    output: list[dict[str, Any]] = []
    for index, token_id in enumerate(token_ids):
        item = by_id.get(token_id)
        if item is None and len(token_ids) == 1 and loose_items:
            item = loose_items[0]
        if item is None and len(token_ids) == 1 and content.strip():
            item = {"literal": content.strip(), "alt": [], "note": ""}
        if item is None:
            continue
        output.append(
            {
                "token_id": token_id,
                "literal": str(item.get("literal") or "").strip(),
                "alt": item.get("alt") if isinstance(item.get("alt"), list) else [],
                "note": item.get("note") if isinstance(item.get("note"), str) else "",
            }
        )

    if not output:
        return content
    return json.dumps(output, ensure_ascii=False, separators=(",", ":"))


def _prepare_messages_for_provider(payload: dict[str, Any]) -> list[dict[str, str]]:
    messages = normalize_messages(payload)
    if _looks_like_literal_request(messages):
        messages.append(
            {
                "role": "system",
                "content": (
                    "For this literal-generation request, return only a strict JSON array. "
                    "Use exactly the token_id values present in the input, at most one object per token_id. "
                    "Each object must be {\"token_id\":\"...\",\"literal\":\"...\",\"alt\":[],\"note\":\"\"}. "
                    "Do not add markdown, comments, duplicate token_id values, or trailing commas."
                ),
            }
        )
        payload["_adapter_literal_request"] = True
    return messages


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


def _extract_result_text(result: dict[str, Any]) -> str:
    for key in ("text", "content", "translation", "answer", "translated_text", "output"):
        value = result.get(key)
        if isinstance(value, str):
            return value
    try:
        content = result["choices"][0]["message"]["content"]
        if isinstance(content, str):
            return content
    except Exception:
        pass
    return ""


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

    messages = _prepare_messages_for_provider(payload)
    upstream_payload: dict[str, Any] = {
        "model": model.upstream_model,
        "messages": messages,
        "stream": False,
    }
    for key in ("temperature", "top_p", "max_tokens", "presence_penalty", "frequency_penalty"):
        if key in payload and payload[key] is not None:
            upstream_payload[key] = payload[key]
    if payload.get("_adapter_literal_request"):
        upstream_payload["temperature"] = 0

    errors: list[str] = []
    data: dict[str, Any] | None = None
    timeout = httpx.Timeout(provider.timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout) as client:
        for path in _path_candidates(provider.chat_path, "/v1/chat/completions"):
            try:
                response = await client.post(_join_url(provider.base_url, path), headers=headers, json=upstream_payload)
            except httpx.HTTPError as exc:
                errors.append(f"{path} -> {exc.__class__.__name__}: {exc}")
                break
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
    if payload.get("_adapter_literal_request"):
        content = _coerce_literal_items(content, messages)
    return {
        "text": content,
        "content": content,
        "translation": content,
        "message": {"role": "assistant", "content": content},
        "choices": data.get("choices", [{"message": {"role": "assistant", "content": content}}]),
        "usage": data.get("usage", {}),
        "provider_response": data,
    }


def extract_model_aggregator_content(payload: dict[str, Any]) -> str:
    for key in ("answer", "content", "translation", "translated_text", "text", "output"):
        value = payload.get(key)
        if isinstance(value, str):
            return value

    raw = payload.get("raw")
    if isinstance(raw, dict):
        try:
            content = raw["choices"][0]["message"]["content"]
            if isinstance(content, str):
                return content
        except Exception:
            pass

    return ""


async def call_model_aggregator(
    provider: RuntimeProvider,
    model: ModelConfig,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if not provider.base_url:
        raise ProviderError(f"Model {model.id} is missing ModelAggregatorService base_url")

    headers = {"Content-Type": "application/json"}
    if provider.api_key:
        headers["Authorization"] = f"Bearer {provider.api_key}"

    messages = _prepare_messages_for_provider(payload)
    upstream_payload: dict[str, Any] = {
        "model": model.upstream_model,
        "messages": messages,
        "metadata": {
            "adapter_model_id": model.id,
            "adapter_provider": provider.id,
            "source": "as-yilin-model-adapter",
        },
    }
    if payload.get("temperature") is not None:
        upstream_payload["temperature"] = payload["temperature"]
    if payload.get("top_p") is not None:
        upstream_payload["topP"] = payload["top_p"]
    if payload.get("maxTokens") is not None:
        upstream_payload["maxTokens"] = payload["maxTokens"]
    elif payload.get("max_tokens") is not None:
        upstream_payload["maxTokens"] = payload["max_tokens"]
    if payload.get("_adapter_literal_request"):
        upstream_payload["temperature"] = 0

    timeout = httpx.Timeout(provider.timeout_seconds)
    url = _join_url(provider.base_url, provider.chat_path or "/api/aggregate/chat")
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, headers=headers, json=upstream_payload)
    except httpx.HTTPError as exc:
        raise ProviderError(f"/api/aggregate/chat -> {exc.__class__.__name__}: {exc}") from exc

    if response.status_code >= 400:
        raise ProviderError(f"/api/aggregate/chat -> HTTP {response.status_code}: {response.text[:500]}")

    data = response.json()
    if data.get("ok") is False:
        raise ProviderError(str(data.get("error") or data.get("message") or "ModelAggregatorService returned ok=false"))

    content = extract_model_aggregator_content(data)
    if not content.strip():
        finish_reason = data.get("finishReason") or data.get("finish_reason") or "unknown"
        raise ProviderError(
            f"/api/aggregate/chat -> upstream model {model.upstream_model} returned empty content "
            f"(finishReason={finish_reason})"
        )
    if payload.get("_adapter_literal_request"):
        content = _coerce_literal_items(content, messages)
    usage = data.get("usage") or {}
    return {
        "text": content,
        "content": content,
        "translation": content,
        "message": {"role": "assistant", "content": content},
        "choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": data.get("finishReason")}],
        "usage": usage,
        "provider_response": data,
    }


async def call_gemini(provider: RuntimeProvider, model: ModelConfig, payload: dict[str, Any]) -> dict[str, Any]:
    if not provider.base_url:
        raise ProviderError(f"Gemini model {model.id} is missing base_url")
    api_keys = provider.api_keys or ([provider.api_key] if provider.api_key else [])
    if not api_keys:
        raise ProviderError(f"Gemini model {model.id} is missing api_keys")

    messages = _prepare_messages_for_provider(payload)
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
        "generationConfig": {"temperature": 0 if payload.get("_adapter_literal_request") else payload.get("temperature", 0.2)},
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
            if payload.get("_adapter_literal_request"):
                content = _coerce_literal_items(content, messages)
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


async def call_compare_all(
    config: AppConfig,
    model: ModelConfig,
    payload: dict[str, Any],
    user: Any = None,
) -> dict[str, Any]:
    messages = normalize_messages(payload)
    if _looks_like_literal_request(messages):
        raise ProviderError("全模型对比暂不支持逐 token 直译，请改用普通模型。")

    candidates = [
        candidate
        for candidate in list_model_configs(config, user)
        if candidate.enabled
        and candidate.id != model.id
        and normalize_provider(candidate.provider) != "adapter_compare"
    ]
    if not candidates:
        raise ProviderError("没有可用于对比的模型。")

    async def run_candidate(candidate: ModelConfig) -> dict[str, Any]:
        candidate_payload = copy.deepcopy(payload)
        candidate_payload["model"] = candidate.id
        candidate_payload["model_id"] = candidate.id
        started = perf_counter()
        try:
            result = await generate_text_for_model(config, candidate, candidate_payload, user)
            return {
                "id": candidate.id,
                "display_name": candidate.display_name or candidate.id,
                "upstream_model": candidate.upstream_model,
                "ok": True,
                "latency_ms": int((perf_counter() - started) * 1000),
                "text": _extract_result_text(result).strip(),
                "usage": result.get("usage") or {},
            }
        except Exception as exc:
            return {
                "id": candidate.id,
                "display_name": candidate.display_name or candidate.id,
                "upstream_model": candidate.upstream_model,
                "ok": False,
                "latency_ms": int((perf_counter() - started) * 1000),
                "error": str(exc),
            }

    results = await asyncio.gather(*(run_candidate(candidate) for candidate in candidates))
    success_count = sum(1 for item in results if item.get("ok") and item.get("text"))
    if success_count == 0:
        errors = [f"{item['display_name']}: {item.get('error') or 'empty result'}" for item in results]
        raise ProviderError("全模型对比失败：" + "；".join(errors))

    sections = [f"全模型翻译对比（共 {len(results)} 个模型）"]
    for item in results:
        title = f"## {item['display_name']}"
        meta = f"上游: {item.get('upstream_model') or item['id']} | 用时: {item.get('latency_ms', 0)}ms"
        if item.get("ok") and item.get("text"):
            body = item["text"]
        else:
            body = f"[调用失败] {item.get('error') or 'empty result'}"
        sections.extend(["", title, meta, body])
    combined = "\n".join(sections).strip()

    usage = {
        "prompt_tokens": sum(int(item.get("usage", {}).get("prompt_tokens") or 0) for item in results if item.get("ok")),
        "completion_tokens": sum(int(item.get("usage", {}).get("completion_tokens") or 0) for item in results if item.get("ok")),
        "total_tokens": sum(int(item.get("usage", {}).get("total_tokens") or 0) for item in results if item.get("ok")),
    }
    return {
        "text": combined,
        "content": combined,
        "translation": combined,
        "message": {"role": "assistant", "content": combined},
        "choices": [{"message": {"role": "assistant", "content": combined}, "finish_reason": "stop"}],
        "usage": usage,
        "provider_response": {
            "comparison": results,
            "successful_models": success_count,
            "total_models": len(results),
        },
    }


async def generate_text_for_model(
    config: AppConfig,
    model: ModelConfig,
    payload: dict[str, Any],
    user: Any = None,
) -> dict[str, Any]:
    provider = _provider_from_model(config, model)
    if provider.type == "adapter_compare":
        return await call_compare_all(config, model, payload, user)
    if provider.type == "model_aggregator":
        return await call_model_aggregator(provider, model, payload)
    if provider.type == "gemini":
        return await call_gemini(provider, model, payload)
    if provider.type != "openai_compatible":
        raise ProviderError(f"Unsupported provider type: {provider.type}")
    return await call_openai_compatible(provider, model, payload)


async def generate_text(config: AppConfig, payload: dict[str, Any], user: Any = None) -> dict[str, Any]:
    model = find_model(config, extract_model_id(payload))
    return await generate_text_for_model(config, model, payload, user)
