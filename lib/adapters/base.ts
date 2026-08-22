// Adapter interface: turns an endpoint's wire format into a stream of
// normalized StreamEvents. The runner never knows whether it's talking to
// OpenWebUI, raw Ollama, or the mock server.

import type { Endpoint, PromptCase, StreamEvent } from "@/lib/types";

export interface Adapter {
  streamChat(endpoint: Endpoint, promptCase: PromptCase): AsyncGenerator<StreamEvent>;
  listModels(endpoint: Endpoint): Promise<string[]>;
}

// Adapter modules import streamLines/authHeaders from this file but not
// vice versa at module-load time, so static imports here don't cycle --
// only this function reaches into them, and only when called.
import { openaiCompatAdapter } from "@/lib/adapters/openaiCompat";
import { ollamaNativeAdapter } from "@/lib/adapters/ollamaNative";

export function getAdapter(name: Endpoint["adapter"]): Adapter {
  if (name === "openai_compat") return openaiCompatAdapter;
  if (name === "ollama_native") return ollamaNativeAdapter;
  throw new Error(`unknown adapter: ${name}`);
}

/** Splits a fetch Response body into text lines as they arrive, regardless
 * of whether the server frames chunks by line (NDJSON) or by SSE event
 * blocks -- callers that need SSE "data:" grouping still get one line per
 * call, matching httpx.aiter_lines() semantics from the original build.
 */
export async function* streamLines(response: Response): AsyncGenerator<string> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        yield buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
      }
    }
    if (buf) yield buf;
  } finally {
    reader.releaseLock();
  }
}

export function authHeaders(endpoint: Endpoint): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (endpoint.api_key) headers["Authorization"] = `Bearer ${endpoint.api_key}`;
  return headers;
}
