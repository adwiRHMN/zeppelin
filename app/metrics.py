"""Aggregate statistics over a list of RequestMetrics: percentiles for
latency and throughput. Pure functions, no I/O -- easy to unit-test and to
call from both the API layer and any future CLI report.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

from app.models import RequestMetrics


def percentile(values: list[float], p: float) -> Optional[float]:
    """Nearest-rank percentile. p is 0-100. Returns None on empty input."""
    if not values:
        return None
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    rank = math.ceil(p / 100 * len(s)) - 1
    rank = min(max(rank, 0), len(s) - 1)
    return s[rank]


@dataclass
class Summary:
    n: int
    n_ok: int
    n_error: int

    ttft_p50: Optional[float]
    ttft_p95: Optional[float]
    ttft_p99: Optional[float]

    total_p50: Optional[float]
    total_p95: Optional[float]
    total_p99: Optional[float]

    decode_tps_mean: Optional[float]

    def as_dict(self) -> dict:
        return {
            "n": self.n,
            "n_ok": self.n_ok,
            "n_error": self.n_error,
            "ttft_p50": self.ttft_p50,
            "ttft_p95": self.ttft_p95,
            "ttft_p99": self.ttft_p99,
            "total_p50": self.total_p50,
            "total_p95": self.total_p95,
            "total_p99": self.total_p99,
            "decode_tps_mean": self.decode_tps_mean,
        }


def summarize(metrics: list[RequestMetrics]) -> Summary:
    """Summarize a batch of results, excluding warmup requests. Errors are
    counted but excluded from the latency/throughput percentiles so a
    handful of failures don't corrupt the timing picture.
    """
    scored = [m for m in metrics if not m.is_warmup]
    ok = [m for m in scored if m.ok]
    errors = [m for m in scored if not m.ok]

    ttfts = [m.ttft_s for m in ok if m.ttft_s is not None]
    totals = [m.total_s for m in ok if m.total_s is not None]
    tps = [m.decode_tokens_per_s for m in ok if m.decode_tokens_per_s is not None]

    return Summary(
        n=len(scored),
        n_ok=len(ok),
        n_error=len(errors),
        ttft_p50=percentile(ttfts, 50),
        ttft_p95=percentile(ttfts, 95),
        ttft_p99=percentile(ttfts, 99),
        total_p50=percentile(totals, 50),
        total_p95=percentile(totals, 95),
        total_p99=percentile(totals, 99),
        decode_tps_mean=(sum(tps) / len(tps)) if tps else None,
    )


def compute_decode_rate(completion_tokens: Optional[int], ttft_s: Optional[float], total_s: Optional[float]) -> Optional[float]:
    """Tokens/sec during the decode phase only (excludes TTFT), so a slow
    prompt-eval doesn't drag down the apparent generation speed.
    """
    if not completion_tokens or total_s is None or ttft_s is None:
        return None
    decode_s = total_s - ttft_s
    if decode_s <= 0:
        return None
    return completion_tokens / decode_s
