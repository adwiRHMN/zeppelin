-- Vercel Postgres schema. Run via `npm run db:migrate` (needs POSTGRES_URL
-- in the environment -- `vercel env pull .env.local` after attaching a
-- Postgres store to the project gets you that).

CREATE TABLE IF NOT EXISTS endpoints (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    adapter TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_cases (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    system_prompt TEXT NOT NULL DEFAULT '',
    user_prompt TEXT NOT NULL,
    temperature DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    max_tokens INTEGER,
    seed INTEGER
);

-- Added after the initial migration -- ADD COLUMN IF NOT EXISTS so this
-- script stays idempotent for both a fresh database and one already at
-- the earlier schema version.
ALTER TABLE prompt_cases ADD COLUMN IF NOT EXISTS json_schema TEXT;
ALTER TABLE prompt_cases ADD COLUMN IF NOT EXISTS input_data TEXT;
ALTER TABLE prompt_cases ADD COLUMN IF NOT EXISTS faithfulness_check BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS runs (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    label TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS results (
    id SERIAL PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    endpoint_id INTEGER NOT NULL,
    case_id INTEGER NOT NULL,
    run_index INTEGER NOT NULL,
    is_warmup BOOLEAN NOT NULL DEFAULT false,
    ok BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT NOT NULL DEFAULT '',
    ttft_s DOUBLE PRECISION,
    total_s DOUBLE PRECISION,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    decode_tokens_per_s DOUBLE PRECISION,
    server_load_s DOUBLE PRECISION,
    server_prompt_eval_s DOUBLE PRECISION,
    server_eval_s DOUBLE PRECISION,
    server_total_s DOUBLE PRECISION,
    proxy_overhead_s DOUBLE PRECISION,
    response_text TEXT NOT NULL DEFAULT '',
    rating INTEGER,
    rating_notes TEXT NOT NULL DEFAULT ''
);

ALTER TABLE results ADD COLUMN IF NOT EXISTS checks_json TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_results_run_id ON results(run_id);
