// Ollama's native /api/chat endpoint (NDJSON streaming, not SSE).
//
// This is the one adapter that gets ground-truth server-side timings: the
// final line of the stream carries load_duration, prompt_eval_duration,
// and eval_duration in nanoseconds. Comparing those against client-measured
// wall time isolates network/proxy overhead from actual model compute --
// useful when the same model is also reachable through OpenWebUI and you
// want to know what the proxy costs you.

import type { Adapter } from "@/lib/adapters/base";
import { authHeaders, streamLines } from "@/lib/adapters/base";
import type { Endpoint, PromptCase, StreamEvent } from "@/lib/types";

const NS_PER_S = 1_000_000_000;

function buildPayload(endpoint: Endpoint, promptCase: PromptCase) {
  const messages: { role: string; content: string }[] = [];
  if (promptCase.system_prompt) messages.push({ role: "system", content: promptCase.system_prompt });
  messages.push({ role: "user", content: promptCase.user_prompt });

  const options: Record<string, unknown> = { temperature: promptCase.temperature };
  if (promptCase.seed != null) options.seed = promptCase.seed;
  if (promptCase.max_tokens != null) options.num_predict = promptCase.max_tokens;

  return { model: endpoint.model, messages, stream: true, options };
}

async function* streamChat(endpoint: Endpoint, promptCase: PromptCase): AsyncGenerator<StreamEvent> {
  const base = endpoint.base_url.replace(/\/+$/, "");
  const headers = authHeaders(endpoint);
  const payload = buildPayload(endpoint, promptCase);

  let resp: Response;
  try {
    resp = await fetch(base + "/api/chat", { method: "POST", headers, body: JSON.stringify(payload) });
  } catch (exc) {
    yield { kind: "error", error_message: `request failed: ${exc}` };
    return;
  }

  if (resp.status >= 400) {
    const body = await resp.text();
    yield { kind: "error", error_message: `HTTP ${resp.status}: ${body.slice(0, 500)}` };
    return;
  }

  for await (const line of streamLines(resp)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (obj.error) {
      yield { kind: "error", error_message: String(obj.error) };
      return;
    }

    const text = obj.message?.content;
    if (text) yield { kind: "delta", text };

    if (obj.done) {
      const loadNs = obj.load_duration;
      const promptNs = obj.prompt_eval_duration;
      const evalNs = obj.eval_duration;
      yield {
        kind: "done",
        prompt_tokens: obj.prompt_eval_count ?? null,
        completion_tokens: obj.eval_count ?? null,
        server_load_s: loadNs != null ? loadNs / NS_PER_S : null,
        server_prompt_eval_s: promptNs != null ? promptNs / NS_PER_S : null,
        server_eval_s: evalNs != null ? evalNs / NS_PER_S : null,
      };
      return;
    }
  }

  yield {
    kind: "done",
    prompt_tokens: null,
    completion_tokens: null,
    server_load_s: null,
    server_prompt_eval_s: null,
    server_eval_s: null,
  };
}

async function listModels(endpoint: Endpoint): Promise<string[]> {
  const base = endpoint.base_url.replace(/\/+$/, "");
  const headers = authHeaders(endpoint);
  const resp = await fetch(base + "/api/tags", { headers });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return (data.models ?? []).map((m: any) => m.name).filter(Boolean);
}

export const ollamaNativeAdapter: Adapter = { streamChat, listModels };
