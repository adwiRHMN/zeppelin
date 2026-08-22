// Single-request executor. One call here == one LLM request, measured
// end to end. The browser drives the repeat/warmup loop and calls this
// once per request through /api/runs/step, so no serverless invocation
// ever has to span a whole batch.

import { getAdapter } from "@/lib/adapters/base";
import { computeDecodeRate } from "@/lib/metrics";
import type { Endpoint, PromptCase, RequestMetrics } from "@/lib/types";

async function executeOnce(
  endpoint: Endpoint,
  promptCase: PromptCase,
  runIndex: number,
  isWarmup: boolean
): Promise<RequestMetrics> {
  const adapter = getAdapter(endpoint.adapter);

  const tStart = performance.now();
  let ttftMs: number | null = null;
  const textParts: string[] = [];
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let serverLoadS: number | null = null;
  let serverPromptEvalS: number | null = null;
  let serverEvalS: number | null = null;
  let ok = true;
  let errorMessage = "";

  try {
    for await (const event of adapter.streamChat(endpoint, promptCase)) {
      if (event.kind === "delta") {
        if (ttftMs === null) ttftMs = performance.now() - tStart;
        textParts.push(event.text);
      } else if (event.kind === "done") {
        promptTokens = event.prompt_tokens;
        completionTokens = event.completion_tokens;
        serverLoadS = event.server_load_s;
        serverPromptEvalS = event.server_prompt_eval_s;
        serverEvalS = event.server_eval_s;
      } else if (event.kind === "error") {
        ok = false;
        errorMessage = event.error_message;
      }
    }
  } catch (exc) {
    // Surface any adapter bug as a failed result, not a crashed run.
    ok = false;
    errorMessage = `${exc instanceof Error ? exc.constructor.name : "Error"}: ${exc}`;
  }

  const totalMs = performance.now() - tStart;
  const ttftS = ttftMs !== null ? ttftMs / 1000 : null;
  const totalS = totalMs / 1000;

  let serverTotalS: number | null = null;
  let proxyOverheadS: number | null = null;
  if (serverLoadS != null && serverPromptEvalS != null && serverEvalS != null) {
    serverTotalS = serverLoadS + serverPromptEvalS + serverEvalS;
    proxyOverheadS = totalS - serverTotalS;
  }

  return {
    endpoint_id: endpoint.id ?? 0,
    case_id: promptCase.id ?? 0,
    run_index: runIndex,
    is_warmup: isWarmup,
    ok,
    error_message: errorMessage,
    ttft_s: ttftS,
    total_s: totalS,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    decode_tokens_per_s: computeDecodeRate(completionTokens, ttftS, totalS),
    server_load_s: serverLoadS,
    server_prompt_eval_s: serverPromptEvalS,
    server_eval_s: serverEvalS,
    server_total_s: serverTotalS,
    proxy_overhead_s: proxyOverheadS,
    response_text: textParts.join(""),
    rating: null,
    rating_notes: "",
  };
}

/** Executes exactly one request and returns its metrics.
 *
 * The run loop lives in the browser rather than here: it calls this once
 * per request via /api/runs/step. That keeps every serverless invocation
 * to the length of a single LLM call instead of an entire batch, which
 * is what makes long runs possible on Vercel's Hobby tier (60s per
 * function). It also means a run's total length is unbounded -- only one
 * individual request has to fit in the budget.
 */
export async function runSingleRequest(
  endpoint: Endpoint,
  promptCase: PromptCase,
  runIndex: number,
  isWarmup: boolean
): Promise<RequestMetrics> {
  return executeOnce(endpoint, promptCase, runIndex, isWarmup);
}
