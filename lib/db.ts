// Neon Postgres persistence (via Vercel's Neon Marketplace integration).
// No ORM -- the schema is small and stable enough that parameterized SQL
// stays readable. All functions are async since the Neon serverless
// driver talks to the database over HTTP.

import { neon } from "@neondatabase/serverless";
import type { Endpoint, PromptCase, RequestMetrics, RunRow } from "@/lib/types";

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL (or POSTGRES_URL) is not set. Attach a Neon/Postgres store " +
      "to the Vercel project, then `vercel env pull .env.local` for local dev."
  );
}

const sql = neon(connectionString);

// --- Endpoints -----------------------------------------------------------

export async function createEndpoint(e: Endpoint): Promise<Endpoint> {
  const rows = (await sql`
    INSERT INTO endpoints (name, base_url, adapter, api_key, model)
    VALUES (${e.name}, ${e.base_url}, ${e.adapter}, ${e.api_key}, ${e.model})
    RETURNING id, name, base_url, adapter, api_key, model
  `) as Endpoint[];
  return rows[0]!;
}

export async function listEndpoints(): Promise<Endpoint[]> {
  return (await sql`SELECT * FROM endpoints ORDER BY id`) as Endpoint[];
}

export async function getEndpoint(id: number): Promise<Endpoint | null> {
  const rows = (await sql`SELECT * FROM endpoints WHERE id = ${id}`) as Endpoint[];
  return rows[0] ?? null;
}

export async function deleteEndpoint(id: number): Promise<void> {
  await sql`DELETE FROM endpoints WHERE id = ${id}`;
}

// --- Prompt cases ----------------------------------------------------------

export async function createCase(c: PromptCase): Promise<PromptCase> {
  const rows = (await sql`
    INSERT INTO prompt_cases (name, system_prompt, user_prompt, temperature, max_tokens, seed)
    VALUES (${c.name}, ${c.system_prompt}, ${c.user_prompt}, ${c.temperature}, ${c.max_tokens}, ${c.seed})
    RETURNING id, name, system_prompt, user_prompt, temperature, max_tokens, seed
  `) as PromptCase[];
  return rows[0]!;
}

export async function listCases(): Promise<PromptCase[]> {
  return (await sql`SELECT * FROM prompt_cases ORDER BY id`) as PromptCase[];
}

export async function getCase(id: number): Promise<PromptCase | null> {
  const rows = (await sql`SELECT * FROM prompt_cases WHERE id = ${id}`) as PromptCase[];
  return rows[0] ?? null;
}

export async function deleteCase(id: number): Promise<void> {
  await sql`DELETE FROM prompt_cases WHERE id = ${id}`;
}

// --- Runs / results ------------------------------------------------------

export async function createRun(label = ""): Promise<number> {
  const rows = (await sql`INSERT INTO runs (label) VALUES (${label}) RETURNING id`) as { id: number }[];
  return rows[0]!.id;
}

export async function listRuns(): Promise<RunRow[]> {
  return (await sql`SELECT * FROM runs ORDER BY id DESC`) as RunRow[];
}

export async function saveResult(runId: number, m: RequestMetrics): Promise<number> {
  const rows = (await sql`
    INSERT INTO results (
      run_id, endpoint_id, case_id, run_index, is_warmup, ok, error_message,
      ttft_s, total_s, prompt_tokens, completion_tokens, decode_tokens_per_s,
      server_load_s, server_prompt_eval_s, server_eval_s, server_total_s,
      proxy_overhead_s, response_text, rating, rating_notes
    ) VALUES (
      ${runId}, ${m.endpoint_id}, ${m.case_id}, ${m.run_index}, ${m.is_warmup}, ${m.ok}, ${m.error_message},
      ${m.ttft_s}, ${m.total_s}, ${m.prompt_tokens}, ${m.completion_tokens}, ${m.decode_tokens_per_s},
      ${m.server_load_s}, ${m.server_prompt_eval_s}, ${m.server_eval_s}, ${m.server_total_s},
      ${m.proxy_overhead_s}, ${m.response_text}, ${m.rating}, ${m.rating_notes}
    ) RETURNING id
  `) as { id: number }[];
  return rows[0]!.id;
}

export async function listResults(runId: number): Promise<RequestMetrics[]> {
  return (await sql`SELECT * FROM results WHERE run_id = ${runId} ORDER BY id`) as RequestMetrics[];
}

export async function setRating(resultId: number, rating: number, notes: string): Promise<void> {
  await sql`UPDATE results SET rating = ${rating}, rating_notes = ${notes} WHERE id = ${resultId}`;
}
