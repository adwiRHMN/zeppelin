// OpenAI-compatible chat completions adapter.
//
// Handles two flavors of the same wire format:
//   - OpenWebUI's proxy:  POST {base}/api/chat/completions
//   - Standard OpenAI-compatible servers (vLLM, LM Studio, TGI, Ollama's
//     own compat shim): POST {base}/v1/chat/completions
//
// Both speak SSE ("data: {...}\n\n" lines, terminated by "data: [DONE]")
// with delta.content chunks and an optional trailing usage object. We try
// the OpenWebUI path first and fall back to /v1/ on a 404, so either
// server type works without extra configuration.

import type { Adapter } from "@/lib/adapters/base";
import { authHeaders, streamLines } from "@/lib/adapters/base";
import type { Endpoint, PromptCase, StreamEvent } from "@/lib/types";

const CANDIDATE_CHAT_PATHS = ["/api/chat/completions", "/v1/chat/completions"];
const CANDIDATE_MODEL_PATHS = ["/api/models", "/v1/models"];

function buildPayload(endpoint: Endpoint, promptCase: PromptCase) {
  const messages: { role: string; content: string }[] = [];
  if (promptCase.system_prompt) messages.push({ role: "system", content: promptCase.system_prompt });
  messages.push({ role: "user", content: promptCase.user_prompt });

  const payload: Record<string, unknown> = {
    model: endpoint.model,
    messages,
    stream: true,
    temperature: promptCase.temperature,
  };
  if (promptCase.max_tokens != null) payload.max_tokens = promptCase.max_tokens;
  if (promptCase.seed != null) payload.seed = promptCase.seed;

  // OpenAI-compatible structured output. Whether the backend behind
  // OpenWebUI's proxy actually honors this (vs. silently dropping it) is
  // exactly the kind of thing worth testing here rather than assuming --
  // a schema that fails to parse is dropped rather than sent malformed.
  if (promptCase.json_schema) {
    try {
      const schema = JSON.parse(promptCase.json_schema);
      payload.response_format = { type: "json_schema", json_schema: { name: "response", schema, strict: true } };
    } catch {
      // ignore -- request proceeds without a format constraint
    }
  }

  return payload;
}

async function* streamChat(endpoint: Endpoint, promptCase: PromptCase): AsyncGenerator<StreamEvent> {
  const base = endpoint.base_url.replace(/\/+$/, "");
  const headers = authHeaders(endpoint);
  const payload = buildPayload(endpoint, promptCase);

  let lastError = "";
  for (let i = 0; i < CANDIDATE_CHAT_PATHS.length; i++) {
    const url = base + CANDIDATE_CHAT_PATHS[i];
    let resp: Response;
    try {
      resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
    } catch (exc) {
      lastError = `request failed: ${exc}`;
      continue;
    }

    if (resp.status === 404 && i < CANDIDATE_CHAT_PATHS.length - 1) {
      lastError = "404, trying next path";
      continue;
    }
    if (resp.status >= 400) {
      const body = await resp.text();
      yield { kind: "error", error_message: `HTTP ${resp.status}: ${body.slice(0, 500)}` };
      return;
    }

    let promptTokens: number | null = null;
    let completionTokens: number | null = null;

    for await (const line of streamLines(resp)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice("data:".length).trim();
      if (data === "[DONE]") break;
      let obj: any;
      try {
        obj = JSON.parse(data);
      } catch {
        continue;
      }

      const usage = obj.usage;
      if (usage) {
        promptTokens = usage.prompt_tokens ?? promptTokens;
        completionTokens = usage.completion_tokens ?? completionTokens;
      }

      const choice = obj.choices?.[0];
      const text = choice?.delta?.content;
      if (text) yield { kind: "delta", text };
    }

    yield {
      kind: "done",
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      server_load_s: null,
      server_prompt_eval_s: null,
      server_eval_s: null,
    };
    return;
  }

  yield { kind: "error", error_message: `request failed: ${lastError}` };
}

async function listModels(endpoint: Endpoint): Promise<string[]> {
  const base = endpoint.base_url.replace(/\/+$/, "");
  const headers = authHeaders(endpoint);
  let lastError = "";
  for (const path of CANDIDATE_MODEL_PATHS) {
    try {
      const resp = await fetch(base + path, { headers });
      if (resp.status === 404) continue;
      if (!resp.ok) {
        lastError = `HTTP ${resp.status}`;
        continue;
      }
      const data = await resp.json();
      const items: any[] = data.data ?? data.models ?? [];
      const names = items
        .map((item) => (typeof item === "string" ? item : item.id ?? item.name ?? ""))
        .filter(Boolean);
      return names;
    } catch (exc) {
      lastError = String(exc);
    }
  }
  throw new Error(`could not list models: ${lastError}`);
}

export const openaiCompatAdapter: Adapter = { streamChat, listModels };
