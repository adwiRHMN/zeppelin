"""Sequential test runner: for each (endpoint, case) pair, optionally fires
a warmup request (to absorb cold-model load time) then N timed repeats,
back-to-back. Yields RequestMetrics as they complete so the caller (the SSE
API route) can stream progress to the GUI live rather than waiting for the
whole batch.
"""
from __future__ import annotations

import asyncio
import time
from typing import AsyncIterator

import httpx

from app.adapters.base import get_adapter
from app.metrics import compute_decode_rate
from app.models import Endpoint, PromptCase, RequestMetrics, RunRequest

REQUEST_TIMEOUT_S = 300.0


async def _execute_once(
    client: httpx.AsyncClient,
    endpoint: Endpoint,
    case: PromptCase,
    run_index: int,
    is_warmup: bool,
) -> RequestMetrics:
    adapter = get_adapter(endpoint.adapter)

    t_start = time.perf_counter()
    ttft: float | None = None
    text_parts: list[str] = []
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    server_load_s: float | None = None
    server_prompt_eval_s: float | None = None
    server_eval_s: float | None = None
    ok = True
    error_message = ""

    try:
        async for event in adapter.stream_chat(client, endpoint, case):
            if event.kind == "delta":
                if ttft is None:
                    ttft = time.perf_counter() - t_start
                text_parts.append(event.text)
            elif event.kind == "done":
                prompt_tokens = event.prompt_tokens
                completion_tokens = event.completion_tokens
                server_load_s = event.server_load_s
                server_prompt_eval_s = event.server_prompt_eval_s
                server_eval_s = event.server_eval_s
            elif event.kind == "error":
                ok = False
                error_message = event.error_message
    except Exception as exc:  # noqa: BLE001 - surface any adapter bug as a failed result, not a crashed run
        ok = False
        error_message = f"{type(exc).__name__}: {exc}"

    total = time.perf_counter() - t_start

    server_total_s = None
    proxy_overhead_s = None
    if server_load_s is not None and server_prompt_eval_s is not None and server_eval_s is not None:
        server_total_s = server_load_s + server_prompt_eval_s + server_eval_s
        proxy_overhead_s = total - server_total_s

    return RequestMetrics(
        endpoint_id=endpoint.id or 0,
        case_id=case.id or 0,
        run_index=run_index,
        is_warmup=is_warmup,
        ok=ok,
        error_message=error_message,
        ttft_s=ttft,
        total_s=total,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        decode_tokens_per_s=compute_decode_rate(completion_tokens, ttft, total),
        server_load_s=server_load_s,
        server_prompt_eval_s=server_prompt_eval_s,
        server_eval_s=server_eval_s,
        server_total_s=server_total_s,
        proxy_overhead_s=proxy_overhead_s,
        response_text="".join(text_parts),
    )


async def run_sequential(
    request: RunRequest,
    endpoints: dict[int, Endpoint],
    cases: dict[int, PromptCase],
) -> AsyncIterator[RequestMetrics]:
    """Runs every (endpoint, case) combination in request, sequentially,
    yielding each RequestMetrics as soon as it's available.
    """
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
        for endpoint_id in request.endpoint_ids:
            endpoint = endpoints[endpoint_id]
            for case_id in request.case_ids:
                case = cases[case_id]

                if request.warmup:
                    await _execute_once(client, endpoint, case, run_index=-1, is_warmup=True)
                    if request.delay_between_s:
                        await asyncio.sleep(request.delay_between_s)

                for i in range(request.repeats):
                    metrics = await _execute_once(client, endpoint, case, run_index=i, is_warmup=False)
                    yield metrics
                    if request.delay_between_s and i < request.repeats - 1:
                        await asyncio.sleep(request.delay_between_s)
