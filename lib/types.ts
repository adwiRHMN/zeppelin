// Shared types across adapters, runner, API routes, and the frontend.

export type AdapterName = "openai_compat" | "ollama_native";

export interface Endpoint {
  id?: number;
  name: string;
  base_url: string;
  adapter: AdapterName;
  api_key: string;
  model: string;
}

export interface PromptCase {
  id?: number;
  name: string;
  system_prompt: string;
  user_prompt: string;
  temperature: number;
  max_tokens: number | null;
  seed: number | null;

  // JSON Schema text, passed to the model as a structured-output
  // constraint: Ollama's `format` field, or OpenAI-compatible
  // `response_format: {type: "json_schema", ...}`. Null/empty = no
  // constraint requested.
  json_schema: string | null;
  // Ground-truth data (e.g. a metrics bundle) as JSON text. Used as the
  // source of truth for the faithfulness check -- every number the model
  // outputs must trace back to a value in here.
  input_data: string | null;
  // If true and input_data is set, every result for this case is
  // auto-scored against the faithfulness check.
  faithfulness_check: boolean;
}

// One normalized event an adapter yields while streaming a response.
// Adapters translate their wire format (OpenAI SSE, Ollama NDJSON) into
// this shape so the runner never needs to know which backend it's hitting.
export type StreamEvent =
  | { kind: "delta"; text: string }
  | {
      kind: "done";
      prompt_tokens: number | null;
      completion_tokens: number | null;
      server_load_s: number | null;
      server_prompt_eval_s: number | null;
      server_eval_s: number | null;
    }
  | { kind: "error"; error_message: string };

export interface RequestMetrics {
  id?: number;
  run_id?: number;
  endpoint_id: number;
  case_id: number;
  run_index: number;
  is_warmup: boolean;

  ok: boolean;
  error_message: string;

  ttft_s: number | null;
  total_s: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  decode_tokens_per_s: number | null;

  server_load_s: number | null;
  server_prompt_eval_s: number | null;
  server_eval_s: number | null;
  server_total_s: number | null;
  proxy_overhead_s: number | null;

  response_text: string;

  rating: number | null;
  rating_notes: string;

  // JSON-stringified CheckResult[] -- mirrors the DB column literally
  // (like the rest of this type), so it's parsed on demand rather than
  // carried as a structured field that would need reconciling on read.
  checks_json: string;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export function parseChecks(checksJson: string | null | undefined): CheckResult[] {
  if (!checksJson) return [];
  try {
    const parsed = JSON.parse(checksJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface RunRequest {
  endpoint_ids: number[];
  case_ids: number[];
  repeats: number;
  warmup: boolean;
  delay_between_s: number;
}

export interface RunSummary {
  endpoint_id: number;
  case_id: number;
  n: number;
  n_ok: number;
  n_error: number;
  ttft_p50: number | null;
  ttft_p95: number | null;
  ttft_p99: number | null;
  total_p50: number | null;
  total_p95: number | null;
  total_p99: number | null;
  decode_tps_mean: number | null;
  // Faithfulness pass rate among results that actually had the check
  // configured -- null if none in this group did (not "0/0 passed").
  faithfulness_checked: number;
  faithfulness_passed: number;
}

export interface RunRow {
  id: number;
  created_at: string;
  label: string;
}
