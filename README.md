# API Testing Kit

A lightweight latency and response-quality testing kit for a locally-hosted
LLM API, deployed on Vercel. Built for a setup running Ollama behind
OpenWebUI, but works with any OpenAI-compatible server (vLLM, LM Studio,
TGI) or raw Ollama.

- Next.js App Router (TypeScript), API routes on the Node runtime.
- Neon Postgres (via Vercel's Marketplace integration) for run history and
  ratings.
- Streams responses live in the GUI while measuring time-to-first-token,
  total latency, and decode throughput.
- Against Ollama's native API, also pulls server-side timings
  (`load_duration`, `prompt_eval_duration`, `eval_duration`) so you can see
  how much latency is model compute vs. network/proxy overhead.

## Why this needs a tunnel

Vercel functions run in Vercel's cloud, not on your network -- they can't
reach `localhost` or a LAN IP. To let the deployed kit reach your local
LLM server, expose it with **Tailscale Funnel**:

```bash
# on the machine running OpenWebUI / Ollama, once Tailscale is installed:
tailscale funnel 3000    # or 11434 for raw Ollama
```

This gives you a public HTTPS URL like `https://your-machine.ts.net` that
forwards to the local port. Use that as the endpoint's base URL in the
kit. Funnel has to stay running for the deployed kit to reach your server
-- it's not a one-time setup step.

## Setup

### 1. Database

In the Vercel dashboard: **Storage → Create Database → Postgres**
(Neon-backed) and connect it to this project. Then locally:

```bash
npm install
vercel link              # if not already linked
vercel env pull .env.local
npm run db:migrate       # creates the schema
```

### 2. Local dev

```bash
npm run dev
```

Open http://localhost:3000.

### 3. Deploy

```bash
vercel deploy --prod
```

Or just push to the branch/PR Vercel is watching -- it builds and deploys
automatically.

## Usage

1. **Endpoints** — add your server. For OpenWebUI, use your Tailscale
   Funnel URL, adapter "OpenAI-compatible", and an API key from Settings →
   Account → API Keys in OpenWebUI (the admin must have "Enable API Key"
   turned on). For raw Ollama, use adapter "Ollama native" — no key
   needed, and you get server-side timing breakdowns.
2. **Prompts** — add one or more test cases (system prompt, user prompt,
   temperature, max tokens, seed).
3. **Run** — pick endpoints × cases, set repeat count and optional warmup
   (a throwaway first request so cold-model load time doesn't pollute your
   stats), hit start. Watch live per-request timings stream in.
4. **Results** — p50/p95/p99 tables per endpoint × case, per-request
   detail with response text and a 1–5 star rating, CSV export.

## Comparing OpenWebUI vs. raw Ollama

Add the same model as two endpoints — one through OpenWebUI, one hitting
Ollama directly (both via Funnel) — and run the same cases against both.
The gap between their `total_s` numbers is what OpenWebUI's proxy layer
costs you. The Ollama-native endpoint's `proxy_overhead_s` column (client
total minus server-reported total) tells you how much of that is network
vs. mis-measurement.

## Vercel plan limits to know about

- **Function duration.** A run streams via one long-lived serverless
  function (`/api/runs/start`). Hobby caps functions at 60s regardless of
  config; Pro allows up to 300s (`maxDuration` is already set there).
  Keep `repeats × endpoints × cases` modest on Hobby, or split into
  several smaller runs — a timeout doesn't lose already-completed results,
  it just stops the batch partway through.
- **No local filesystem persistence.** All state lives in Postgres, not a
  file, precisely because Vercel's filesystem doesn't persist between
  invocations.

## Quality checks

`lib/quality.ts` has a small registry of deterministic checks (`contains`,
`regex`, `min_length`) that isn't wired into the GUI yet — manual star
rating is the baseline quality signal for now. Extend the registry with
`registerCheck(name, fn)` and hook it into the runner when you decide what
you want to check for (LLM-as-judge, embedding similarity, etc.).

## Layout

```
app/
  page.tsx                    Four-tab GUI (client component)
  layout.tsx, globals.css
  api/
    endpoints/                CRUD + connection test
    cases/                    CRUD for prompt cases
    runs/start/               SSE-streamed sequential run
    runs/[id]/results/        results + percentile summaries
    results/[id]/rating/      manual quality rating
lib/
  adapters/                   openaiCompat.ts (OpenWebUI + /v1),
                               ollamaNative.ts (NDJSON, server timings)
  runner.ts                   sequential test execution
  metrics.ts                  percentiles, decode rate
  db.ts                       Neon/Postgres persistence
  quality.ts                  pluggable check registry
  types.ts                    shared types
scripts/
  schema.sql, migrate.ts      one-shot DB setup
```
