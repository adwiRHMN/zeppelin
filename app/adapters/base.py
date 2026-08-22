"""Adapter protocol: turns endpoint-specific wire formats into a stream of
normalized StreamEvent objects. The runner and API layer only ever talk to
this interface -- they never know whether they're hitting OpenWebUI, raw
Ollama, or the mock server.
"""
from __future__ import annotations

from typing import AsyncIterator, Protocol

import httpx

from app.models import Endpoint, PromptCase, StreamEvent


class Adapter(Protocol):
    async def stream_chat(
        self,
        client: httpx.AsyncClient,
        endpoint: Endpoint,
        case: PromptCase,
    ) -> AsyncIterator[StreamEvent]:
        """Send one chat request and yield StreamEvents as they arrive.
        Must yield exactly one 'done' or 'error' event as the final event.
        """
        ...

    async def list_models(self, client: httpx.AsyncClient, endpoint: Endpoint) -> list[str]:
        """Return model names available at this endpoint, for the
        'test connection' button. Raise on failure -- caller catches it.
        """
        ...


def get_adapter(name: str) -> Adapter:
    if name == "openai_compat":
        from app.adapters.openai_compat import OpenAICompatAdapter

        return OpenAICompatAdapter()
    if name == "ollama_native":
        from app.adapters.ollama_native import OllamaNativeAdapter

        return OllamaNativeAdapter()
    raise ValueError(f"unknown adapter: {name!r}")
