// Aggregate statistics over a batch of RequestMetrics: percentiles for
// latency, mean decode throughput. Pure functions -- no I/O.

import type { RequestMetrics, RunSummary } from "@/lib/types";
import { parseChecks } from "@/lib/types";

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const rank = Math.min(Math.max(Math.ceil((p / 100) * sorted.length) - 1, 0), sorted.length - 1);
  return sorted[rank]!;
}

/** Summarizes one (endpoint, case) group, excluding warmup requests.
 * Errors are counted but excluded from latency/throughput percentiles so
 * a handful of failures don't corrupt the timing picture.
 */
export function summarize(endpointId: number, caseId: number, metrics: RequestMetrics[]): RunSummary {
  const scored = metrics.filter((m) => !m.is_warmup);
  const ok = scored.filter((m) => m.ok);
  const errors = scored.filter((m) => !m.ok);

  const ttfts = ok.map((m) => m.ttft_s).filter((v): v is number => v != null);
  const totals = ok.map((m) => m.total_s).filter((v): v is number => v != null);
  const tps = ok.map((m) => m.decode_tokens_per_s).filter((v): v is number => v != null);

  let faithfulnessChecked = 0;
  let faithfulnessPassed = 0;
  for (const m of ok) {
    const check = parseChecks(m.checks_json).find((c) => c.name === "faithfulness");
    if (!check) continue;
    faithfulnessChecked++;
    if (check.passed) faithfulnessPassed++;
  }

  return {
    endpoint_id: endpointId,
    case_id: caseId,
    n: scored.length,
    n_ok: ok.length,
    n_error: errors.length,
    ttft_p50: percentile(ttfts, 50),
    ttft_p95: percentile(ttfts, 95),
    ttft_p99: percentile(ttfts, 99),
    total_p50: percentile(totals, 50),
    total_p95: percentile(totals, 95),
    total_p99: percentile(totals, 99),
    decode_tps_mean: tps.length ? tps.reduce((a, b) => a + b, 0) / tps.length : null,
    faithfulness_checked: faithfulnessChecked,
    faithfulness_passed: faithfulnessPassed,
  };
}

export function summarizeAll(metrics: RequestMetrics[]): RunSummary[] {
  const groups = new Map<string, { endpointId: number; caseId: number; items: RequestMetrics[] }>();
  for (const m of metrics) {
    const key = `${m.endpoint_id}:${m.case_id}`;
    if (!groups.has(key)) groups.set(key, { endpointId: m.endpoint_id, caseId: m.case_id, items: [] });
    groups.get(key)!.items.push(m);
  }
  return [...groups.values()].map((g) => summarize(g.endpointId, g.caseId, g.items));
}

/** Tokens/sec during the decode phase only (excludes TTFT), so a slow
 * prompt-eval phase doesn't drag down the apparent generation speed.
 */
export function computeDecodeRate(
  completionTokens: number | null,
  ttftS: number | null,
  totalS: number | null
): number | null {
  if (!completionTokens || totalS == null || ttftS == null) return null;
  const decodeS = totalS - ttftS;
  if (decodeS <= 0) return null;
  return completionTokens / decodeS;
}
