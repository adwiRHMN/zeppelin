"""Pydantic schemas shared across adapters, runner, API, and storage."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class Endpoint(BaseModel):
    id: Optional[int] = None
    name: str
    base_url: str
    adapter: Literal["openai_compat", "ollama_native"]
    api_key: str = ""
    model: str


class PromptCase(BaseModel):
    id: Optional[int] = None
    name: str
    system_prompt: str = ""
    user_prompt: str
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    seed: Optional[int] = None


class StreamEvent(BaseModel):
    """One normalized event emitted by an adapter while streaming a response.

    Adapters translate their wire format (OpenAI SSE deltas, Ollama NDJSON
    lines) into this shape so the runner never has to know which backend it
    is talking to.
    """

    kind: Literal["delta", "done", "error"]
    text: str = ""
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    # Ollama-only server-side timings, all in seconds. None for adapters
    # that don't report them (e.g. plain OpenAI-compatible servers).
    server_load_s: Optional[float] = None
    server_prompt_eval_s: Optional[float] = None
    server_eval_s: Optional[float] = None
    error_message: str = ""


class RequestMetrics(BaseModel):
    """Everything measured client-side for a single request, plus whatever
    server-side timings the adapter was able to harvest.
    """

    endpoint_id: int
    case_id: int
    run_index: int
    is_warmup: bool = False

    ok: bool = True
    error_message: str = ""

    ttft_s: Optional[float] = None
    total_s: Optional[float] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    decode_tokens_per_s: Optional[float] = None

    server_load_s: Optional[float] = None
    server_prompt_eval_s: Optional[float] = None
    server_eval_s: Optional[float] = None
    server_total_s: Optional[float] = None
    proxy_overhead_s: Optional[float] = None

    response_text: str = ""

    # Manual quality rating, filled in later via the GUI -- absent at
    # capture time.
    rating: Optional[int] = None
    rating_notes: str = ""


class RunRequest(BaseModel):
    endpoint_ids: list[int]
    case_ids: list[int]
    repeats: int = Field(default=3, ge=1, le=100)
    warmup: bool = True
    delay_between_s: float = Field(default=0.0, ge=0.0)
