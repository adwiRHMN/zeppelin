// Sequential test runner: for each (endpoint, case) pair, optionally fires
// a warmup request (to absorb cold-model load time) then N timed repeats,
// back-to-back. Yields RequestMetrics as they complete so the API route
// can stream progress to the GUI live rather than waiting for the whole
// batch (important on Vercel, where a function has a hard time budget).

import { getAdapter } from "@/lib/adapters/base";
import { computeDecodeRate } from "@/lib/metrics";
import type { Endpoint, PromptCase, RequestMetrics, RunRequest } from "@/lib/types";

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

const sleep = (s: number) => new Promise((resolve) => setTimeout(resolve, s * 1000));

/** Runs every (endpoint, case) combination in the request, sequentially,
 * yielding each RequestMetrics as soon as it's available.
 */
export async function* runSequential(
  request: RunRequest,
  endpoints: Map<number, Endpoint>,
  cases: Map<number, PromptCase>
): AsyncGenerator<RequestMetrics> {
  for (const endpointId of request.endpoint_ids) {
    const endpoint = endpoints.get(endpointId);
    if (!endpoint) continue;

    for (const caseId of request.case_ids) {
      const promptCase = cases.get(caseId);
      if (!promptCase) continue;

      if (request.warmup) {
        // Yield the warmup result too, even though summarize() filters it
        // out of the stats. A cold model can take a minute to load, and
        // swallowing this entirely leaves the UI silent for that whole
        // time with no sign the run is alive.
        yield await executeOnce(endpoint, promptCase, -1, true);
        if (request.delay_between_s) await sleep(request.delay_between_s);
      }

      for (let i = 0; i < request.repeats; i++) {
        const metrics = await executeOnce(endpoint, promptCase, i, false);
        yield metrics;
        if (request.delay_between_s && i < request.repeats - 1) await sleep(request.delay_between_s);
      }
    }
  }
}
