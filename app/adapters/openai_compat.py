"""OpenAI-compatible chat completions adapter.

Handles two flavors of the same wire format:
  - OpenWebUI's proxy:  POST {base}/api/chat/completions
  - Standard OpenAI-compatible servers (vLLM, LM Studio, TGI, Ollama's own
    compat shim): POST {base}/v1/chat/completions

Both speak SSE ("data: {...}\\n\\n" lines, terminated by "data: [DONE]") with
delta.content chunks and an optional trailing usage object. We try the
OpenWebUI path first (since that's the documented primary use case here)
and fall back to /v1/ on a 404, so either server type works without extra
configuration.
"""
from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from app.adapters.base import Adapter
from app.models import Endpoint, PromptCase, StreamEvent

CANDIDATE_PATHS = ["/api/chat/completions", "/v1/chat/completions"]


def _headers(endpoint: Endpoint) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if endpoint.api_key:
        headers["Authorization"] = f"Bearer {endpoint.api_key}"
    return headers


def _payload(endpoint: Endpoint, case: PromptCase) -> dict:
    messages = []
    if case.system_prompt:
        messages.append({"role": "system", "content": case.system_prompt})
    messages.append({"role": "user", "content": case.user_prompt})
    payload: dict = {
        "model": endpoint.model,
        "messages": messages,
        "stream": True,
        "temperature": case.temperature,
    }
    if case.max_tokens is not None:
        payload["max_tokens"] = case.max_tokens
    if case.seed is not None:
        payload["seed"] = case.seed
    return payload


class OpenAICompatAdapter(Adapter):
    async def stream_chat(
        self,
        client: httpx.AsyncClient,
        endpoint: Endpoint,
        case: PromptCase,
    ) -> AsyncIterator[StreamEvent]:
        base = endpoint.base_url.rstrip("/")
        headers = _headers(endpoint)
        payload = _payload(endpoint, case)

        last_error: Exception | None = None
        for i, path in enumerate(CANDIDATE_PATHS):
            url = base + path
            try:
                async with client.stream("POST", url, headers=headers, json=payload) as resp:
                    if resp.status_code == 404 and i < len(CANDIDATE_PATHS) - 1:
                        last_error = httpx.HTTPStatusError(
                            "404, trying next path", request=resp.request, response=resp
                        )
                        continue
                    if resp.status_code >= 400:
                        body = await resp.aread()
                        yield StreamEvent(
                            kind="error",
                            error_message=f"HTTP {resp.status_code}: {body[:500]!r}",
                        )
                        return

                    prompt_tokens: int | None = None
                    completion_tokens: int | None = None
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data = line[len("data:"):].strip()
                        if data == "[DONE]":
                            break
                        try:
                            obj = json.loads(data)
                        except json.JSONDecodeError:
                            continue

                        usage = obj.get("usage")
                        if usage:
                            prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
                            completion_tokens = usage.get("completion_tokens", completion_tokens)

                        choices = obj.get("choices") or []
                        if choices:
                            delta = choices[0].get("delta") or {}
                            text = delta.get("content") or ""
                            if text:
                                yield StreamEvent(kind="delta", text=text)

                    yield StreamEvent(
                        kind="done",
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                    )
                    return
            except httpx.HTTPError as exc:
                last_error = exc
                continue

        yield StreamEvent(kind="error", error_message=f"request failed: {last_error}")

    async def list_models(self, client: httpx.AsyncClient, endpoint: Endpoint) -> list[str]:
        base = endpoint.base_url.rstrip("/")
        headers = _headers(endpoint)
        last_error: Exception | None = None
        for path in ["/api/models", "/v1/models"]:
            try:
                resp = await client.get(base + path, headers=headers)
                if resp.status_code == 404:
                    continue
                resp.raise_for_status()
                data = resp.json()
                items = data.get("data") or data.get("models") or []
                names = []
                for item in items:
                    if isinstance(item, str):
                        names.append(item)
                    elif isinstance(item, dict):
                        names.append(item.get("id") or item.get("name") or "")
                return [n for n in names if n]
            except httpx.HTTPError as exc:
                last_error = exc
                continue
        raise RuntimeError(f"could not list models: {last_error}")
