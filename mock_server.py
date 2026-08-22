"""Fake local LLM server for developing/testing the kit without a real
model. Speaks both wire formats:

  - OpenAI-compatible SSE at  /api/chat/completions  and  /v1/chat/completions
  - Ollama native NDJSON at   /api/chat
  - Model listing at          /api/models, /v1/models, /api/tags

Streams a canned response word-by-word with a configurable per-token delay,
so you can sanity-check that TTFT/total/tokens-per-sec come out sane before
pointing the kit at a real server.

Run: python mock_server.py  (listens on :9999)
"""
from __future__ import annotations

import asyncio
import json
import time

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()

CANNED_RESPONSE = (
    "This is a mock response used to sanity check the API testing kit. "
    "It streams one word at a time so timing metrics like time to first "
    "token and decode rate can be verified against a known, controlled "
    "source before the kit is pointed at a real model."
).split(" ")

FIRST_TOKEN_DELAY_S = 0.35
PER_TOKEN_DELAY_S = 0.03


async def _openai_sse(model: str):
    words = CANNED_RESPONSE
    await asyncio.sleep(FIRST_TOKEN_DELAY_S)
    for i, word in enumerate(words):
        chunk = {
            "choices": [{"delta": {"content": word + (" " if i < len(words) - 1 else "")}}]
        }
        yield f"data: {json.dumps(chunk)}\n\n"
        await asyncio.sleep(PER_TOKEN_DELAY_S)
    final = {
        "choices": [{"delta": {}}],
        "usage": {"prompt_tokens": 12, "completion_tokens": len(words)},
    }
    yield f"data: {json.dumps(final)}\n\n"
    yield "data: [DONE]\n\n"


@app.post("/api/chat/completions")
@app.post("/v1/chat/completions")
async def openai_chat(request: Request):
    body = await request.json()
    model = body.get("model", "mock-model")
    return StreamingResponse(_openai_sse(model), media_type="text/event-stream")


async def _ollama_ndjson(model: str):
    words = CANNED_RESPONSE
    t_start = time.perf_counter_ns()
    await asyncio.sleep(FIRST_TOKEN_DELAY_S)
    for i, word in enumerate(words):
        line = {
            "model": model,
            "message": {"role": "assistant", "content": word + (" " if i < len(words) - 1 else "")},
            "done": False,
        }
        yield json.dumps(line) + "\n"
        await asyncio.sleep(PER_TOKEN_DELAY_S)

    total_ns = time.perf_counter_ns() - t_start
    final = {
        "model": model,
        "message": {"role": "assistant", "content": ""},
        "done": True,
        "load_duration": 50_000_000,
        "prompt_eval_count": 12,
        "prompt_eval_duration": int(FIRST_TOKEN_DELAY_S * 1_000_000_000) - 50_000_000,
        "eval_count": len(words),
        "eval_duration": total_ns - int(FIRST_TOKEN_DELAY_S * 1_000_000_000),
    }
    yield json.dumps(final) + "\n"


@app.post("/api/chat")
async def ollama_chat(request: Request):
    body = await request.json()
    model = body.get("model", "mock-model")
    return StreamingResponse(_ollama_ndjson(model), media_type="application/x-ndjson")


@app.get("/api/models")
@app.get("/v1/models")
async def list_models():
    return {"data": [{"id": "mock-model"}]}


@app.get("/api/tags")
async def list_tags():
    return {"models": [{"name": "mock-model"}]}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=9999, log_level="warning")
