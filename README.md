# API Testing Kit

A lightweight latency and response-quality testing kit for a locally-hosted
LLM API. Built for a setup running Ollama behind OpenWebUI, but works with
any OpenAI-compatible server (vLLM, LM Studio, TGI) or raw Ollama.

- FastAPI backend, plain HTML/JS frontend — no npm, no build step.
- SQLite storage — one file, no server to run.
- Streams responses live in the GUI while measuring time-to-first-token,
  total latency, and decode throughput.
- Against Ollama's native API, also pulls server-side timings
  (`load_duration`, `prompt_eval_duration`, `eval_duration`) so you can see
  how much latency is model compute vs. network/proxy overhead.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -e .
cp .env.example .env   # optional, defaults are fine
.venv/bin/python -m app.main
```

Open http://127.0.0.1:8420.

## Usage

1. **Endpoints** — add your server. For OpenWebUI, use base URL
   `http://<host>:3000`, adapter "OpenAI-compatible", and an API key from
   Settings → Account → API Keys in OpenWebUI (the admin must have "Enable
   API Key" turned on). For raw Ollama, use `http://<host>:11434` with
   adapter "Ollama native" — no key needed, and you get server-side timing
   breakdowns.
2. **Prompts** — add one or more test cases (system prompt, user prompt,
   temperature, max tokens, seed).
3. **Run** — pick endpoints × cases, set repeat count and optional warmup
   (a throwaway first request so cold-model load time doesn't pollute your
   stats), hit start. Watch live per-request timings stream in.
4. **Results** — p50/p95/p99 tables per endpoint × case, per-request
   detail with response text and a 1–5 star rating, CSV export.

## Comparing OpenWebUI vs. raw Ollama

Add the same model as two endpoints — one through OpenWebUI, one hitting
Ollama directly — and run the same cases against both. The gap between
their `total_s` numbers is what OpenWebUI's proxy layer costs you. The
Ollama-native endpoint's `proxy_overhead_s` column (client total minus
server-reported total) tells you how much of that is network vs.
mis-measurement.

## Development

`mock_server.py` is a fake local LLM server (canned streaming response,
both wire formats) for developing/testing the kit without a real model:

```bash
.venv/bin/python mock_server.py        # listens on :9999
.venv/bin/python scripts/smoke_test.py # exercises both adapters against it
```

## Quality checks

`app/quality.py` has a small registry of deterministic checks (`contains`,
`regex`, `min_length`) that isn't wired into the GUI yet — manual star
rating is the baseline quality signal for now. Extend the registry with
`@register("name")` and hook it into the runner when you decide what you
want to check for (LLM-as-judge, embedding similarity, etc.).

## Layout

```
app/
  main.py          FastAPI routes + static mount
  config.py        env-driven settings
  adapters/        openai_compat.py (OpenWebUI + /v1), ollama_native.py
  runner.py        sequential test execution
  metrics.py       percentiles, decode rate
  storage.py       SQLite
  quality.py       pluggable check registry
  models.py        pydantic schemas
static/            index.html, app.js, style.css
mock_server.py     fake server for dev
scripts/smoke_test.py
```
