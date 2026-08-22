"""SQLite persistence. Stdlib sqlite3, synchronous -- run inside
run_in_executor from async call sites so it never blocks the event loop.
No ORM: the schema is small and stable enough that raw SQL stays readable.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from typing import Iterator, Optional

from app.config import settings
from app.models import Endpoint, PromptCase, RequestMetrics

SCHEMA = """
CREATE TABLE IF NOT EXISTS endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    adapter TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    system_prompt TEXT NOT NULL DEFAULT '',
    user_prompt TEXT NOT NULL,
    temperature REAL NOT NULL DEFAULT 0.7,
    max_tokens INTEGER,
    seed INTEGER
);

CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    label TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    endpoint_id INTEGER NOT NULL,
    case_id INTEGER NOT NULL,
    run_index INTEGER NOT NULL,
    is_warmup INTEGER NOT NULL DEFAULT 0,
    ok INTEGER NOT NULL DEFAULT 1,
    error_message TEXT NOT NULL DEFAULT '',
    ttft_s REAL,
    total_s REAL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    decode_tokens_per_s REAL,
    server_load_s REAL,
    server_prompt_eval_s REAL,
    server_eval_s REAL,
    server_total_s REAL,
    proxy_overhead_s REAL,
    response_text TEXT NOT NULL DEFAULT '',
    rating INTEGER,
    rating_notes TEXT NOT NULL DEFAULT '',
    checks_json TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_results_run_id ON results(run_id);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(SCHEMA)


@contextmanager
def _cursor() -> Iterator[sqlite3.Cursor]:
    conn = _connect()
    try:
        cur = conn.cursor()
        yield cur
        conn.commit()
    finally:
        conn.close()


# --- Endpoints ---------------------------------------------------------

def create_endpoint(e: Endpoint) -> int:
    with _cursor() as cur:
        cur.execute(
            "INSERT INTO endpoints (name, base_url, adapter, api_key, model) VALUES (?, ?, ?, ?, ?)",
            (e.name, e.base_url, e.adapter, e.api_key, e.model),
        )
        return cur.lastrowid


def list_endpoints() -> list[Endpoint]:
    with _cursor() as cur:
        rows = cur.execute("SELECT * FROM endpoints ORDER BY id").fetchall()
        return [Endpoint(**dict(r)) for r in rows]


def get_endpoint(endpoint_id: int) -> Optional[Endpoint]:
    with _cursor() as cur:
        row = cur.execute("SELECT * FROM endpoints WHERE id = ?", (endpoint_id,)).fetchone()
        return Endpoint(**dict(row)) if row else None


def delete_endpoint(endpoint_id: int) -> None:
    with _cursor() as cur:
        cur.execute("DELETE FROM endpoints WHERE id = ?", (endpoint_id,))


# --- Prompt cases --------------------------------------------------------

def create_case(c: PromptCase) -> int:
    with _cursor() as cur:
        cur.execute(
            "INSERT INTO prompt_cases (name, system_prompt, user_prompt, temperature, max_tokens, seed) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (c.name, c.system_prompt, c.user_prompt, c.temperature, c.max_tokens, c.seed),
        )
        return cur.lastrowid


def list_cases() -> list[PromptCase]:
    with _cursor() as cur:
        rows = cur.execute("SELECT * FROM prompt_cases ORDER BY id").fetchall()
        return [PromptCase(**dict(r)) for r in rows]


def get_case(case_id: int) -> Optional[PromptCase]:
    with _cursor() as cur:
        row = cur.execute("SELECT * FROM prompt_cases WHERE id = ?", (case_id,)).fetchone()
        return PromptCase(**dict(row)) if row else None


def delete_case(case_id: int) -> None:
    with _cursor() as cur:
        cur.execute("DELETE FROM prompt_cases WHERE id = ?", (case_id,))


# --- Runs / results ------------------------------------------------------

def create_run(label: str = "") -> int:
    with _cursor() as cur:
        cur.execute("INSERT INTO runs (label) VALUES (?)", (label,))
        return cur.lastrowid


def list_runs() -> list[dict]:
    with _cursor() as cur:
        rows = cur.execute("SELECT * FROM runs ORDER BY id DESC").fetchall()
        return [dict(r) for r in rows]


def save_result(run_id: int, m: RequestMetrics) -> int:
    with _cursor() as cur:
        cur.execute(
            """INSERT INTO results (
                run_id, endpoint_id, case_id, run_index, is_warmup, ok, error_message,
                ttft_s, total_s, prompt_tokens, completion_tokens, decode_tokens_per_s,
                server_load_s, server_prompt_eval_s, server_eval_s, server_total_s,
                proxy_overhead_s, response_text, rating, rating_notes, checks_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run_id, m.endpoint_id, m.case_id, m.run_index, int(m.is_warmup), int(m.ok), m.error_message,
                m.ttft_s, m.total_s, m.prompt_tokens, m.completion_tokens, m.decode_tokens_per_s,
                m.server_load_s, m.server_prompt_eval_s, m.server_eval_s, m.server_total_s,
                m.proxy_overhead_s, m.response_text, m.rating, m.rating_notes, json.dumps(None),
            ),
        )
        return cur.lastrowid


def list_results(run_id: int) -> list[dict]:
    with _cursor() as cur:
        rows = cur.execute("SELECT * FROM results WHERE run_id = ? ORDER BY id", (run_id,)).fetchall()
        return [dict(r) for r in rows]


def set_rating(result_id: int, rating: int, notes: str) -> None:
    with _cursor() as cur:
        cur.execute(
            "UPDATE results SET rating = ?, rating_notes = ? WHERE id = ?",
            (rating, notes, result_id),
        )
