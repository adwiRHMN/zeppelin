"""Pluggable quality-check registry. Empty on purpose -- the user hasn't
decided which checks they want yet (assertion matching, LLM-as-judge,
embedding similarity, etc.). Each check is a function from
(response_text, params) -> dict result; registering one here makes it
selectable from the GUI without touching the runner or storage layer.

For now, manual 1-5 star rating (storage.set_rating) covers the baseline
quality signal.
"""
from __future__ import annotations

from typing import Callable

CheckFn = Callable[[str, dict], dict]

_REGISTRY: dict[str, CheckFn] = {}


def register(name: str):
    def deco(fn: CheckFn) -> CheckFn:
        _REGISTRY[name] = fn
        return fn

    return deco


def run_check(name: str, response_text: str, params: dict) -> dict:
    if name not in _REGISTRY:
        raise ValueError(f"unknown quality check: {name!r}")
    return _REGISTRY[name](response_text, params)


def available_checks() -> list[str]:
    return sorted(_REGISTRY.keys())


# --- built-in checks -------------------------------------------------
# Deliberately minimal for now; extend when quality criteria are decided.

@register("contains")
def _contains(text: str, params: dict) -> dict:
    needle = params.get("needle", "")
    case_sensitive = params.get("case_sensitive", False)
    hay = text if case_sensitive else text.lower()
    n = needle if case_sensitive else needle.lower()
    passed = n in hay
    return {"passed": passed, "detail": f"{'found' if passed else 'missing'}: {needle!r}"}


@register("regex")
def _regex(text: str, params: dict) -> dict:
    import re

    pattern = params.get("pattern", "")
    match = re.search(pattern, text)
    return {"passed": match is not None, "detail": f"pattern {pattern!r} {'matched' if match else 'did not match'}"}


@register("min_length")
def _min_length(text: str, params: dict) -> dict:
    min_chars = params.get("min_chars", 0)
    passed = len(text) >= min_chars
    return {"passed": passed, "detail": f"length={len(text)}, min={min_chars}"}
