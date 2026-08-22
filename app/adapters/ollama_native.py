"""Ollama's native /api/chat endpoint (NDJSON streaming, not SSE).

This is the one adapter that gets ground-truth server-side timings: the
final line of the stream carries load_duration, prompt_eval_duration, and
eval_duration in nanoseconds. Comparing those against client-measured wall
time isolates network/proxy overhead from actual model compute -- useful
when you also have the same model running behind OpenWebUI and want to know
what the proxy costs you.
"""
from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from app.adapters.base import Adapter
from app.models import Endpoint, PromptCase, StreamEvent

NS_PER_S = 1_000_000_000


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
    options: dict = {"temperature": case.temperature}
    if case.seed is not None:
        options["seed"] = case.seed
    if case.max_tokens is not None:
        options["num_predict"] = case.max_tokens
    return {
        "model": endpoint.model,
        "messages": messages,
        "stream": True,
        "options": options,
    }


class OllamaNativeAdapter(Adapter):
    async def stream_chat(
        self,
        client: httpx.AsyncClient,
        endpoint: Endpoint,
        case: PromptCase,
    ) -> AsyncIterator[StreamEvent]:
        base = endpoint.base_url.rstrip("/")
        url = base + "/api/chat"
        headers = _headers(endpoint)
        payload = _payload(endpoint, case)

        try:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                if resp.status_code >= 400:
                    body = await resp.aread()
                    yield StreamEvent(
                        kind="error",
                        error_message=f"HTTP {resp.status_code}: {body[:500]!r}",
                    )
                    return

                async for line in resp.aiter_lines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    if obj.get("error"):
                        yield StreamEvent(kind="error", error_message=str(obj["error"]))
                        return

                    message = obj.get("message") or {}
                    text = message.get("content") or ""
                    if text:
                        yield StreamEvent(kind="delta", text=text)

                    if obj.get("done"):
                        load_ns = obj.get("load_duration")
                        prompt_ns = obj.get("prompt_eval_duration")
                        eval_ns = obj.get("eval_duration")
                        yield StreamEvent(
                            kind="done",
                            prompt_tokens=obj.get("prompt_eval_count"),
                            completion_tokens=obj.get("eval_count"),
                            server_load_s=(load_ns / NS_PER_S) if load_ns is not None else None,
                            server_prompt_eval_s=(prompt_ns / NS_PER_S) if prompt_ns is not None else None,
                            server_eval_s=(eval_ns / NS_PER_S) if eval_ns is not None else None,
                        )
                        return

                yield StreamEvent(kind="done")
        except httpx.HTTPError as exc:
            yield StreamEvent(kind="error", error_message=f"request failed: {exc}")

    async def list_models(self, client: httpx.AsyncClient, endpoint: Endpoint) -> list[str]:
        base = endpoint.base_url.rstrip("/")
        headers = _headers(endpoint)
        resp = await client.get(base + "/api/tags", headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return [m.get("name", "") for m in data.get("models", []) if m.get("name")]
