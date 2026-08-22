"""Dev-only smoke test: hits the mock server through both adapters and
prints what came back. Not part of the shipped kit -- just a fast way to
verify the adapter layer end-to-end while building.

Run: python mock_server.py &  then  python scripts/smoke_test.py
"""
from __future__ import annotations

import asyncio
import time

import httpx

from app.adapters.base import get_adapter
from app.models import Endpoint, PromptCase

CASE = PromptCase(name="smoke", user_prompt="Say hello.")


async def run(adapter_name: str, base_url: str):
    endpoint = Endpoint(name="mock", base_url=base_url, adapter=adapter_name, model="mock-model")
    adapter = get_adapter(adapter_name)

    async with httpx.AsyncClient(timeout=30.0) as client:
        models = await adapter.list_models(client, endpoint)
        print(f"[{adapter_name}] models: {models}")

        t0 = time.perf_counter()
        ttft = None
        text = ""
        async for event in adapter.stream_chat(client, endpoint, CASE):
            if event.kind == "delta":
                if ttft is None:
                    ttft = time.perf_counter() - t0
                text += event.text
            elif event.kind == "done":
                total = time.perf_counter() - t0
                print(f"[{adapter_name}] ttft={ttft:.3f}s total={total:.3f}s "
                      f"prompt_tok={event.prompt_tokens} completion_tok={event.completion_tokens}")
                if event.server_eval_s is not None:
                    print(f"[{adapter_name}] server load={event.server_load_s:.3f}s "
                          f"prompt_eval={event.server_prompt_eval_s:.3f}s eval={event.server_eval_s:.3f}s")
                print(f"[{adapter_name}] text: {text!r}")
            elif event.kind == "error":
                print(f"[{adapter_name}] ERROR: {event.error_message}")


async def main():
    await run("openai_compat", "http://127.0.0.1:9999")
    print()
    await run("ollama_native", "http://127.0.0.1:9999")


if __name__ == "__main__":
    asyncio.run(main())
