// Executes exactly one request of a run, persists it, and returns its
// metrics. The browser calls this repeatedly to work through a run's
// plan.
//
// maxDuration is 60 because that is Vercel's Hobby ceiling -- one LLM
// request has to fit inside it. If a single generation legitimately
// takes longer than that, cap it with the prompt case's max_tokens
// rather than raising this, unless you're on Pro (where up to 300 is
// allowed).
import { NextResponse } from "next/server";
import { getCase, getEndpoint, saveResult } from "@/lib/db";
import { runSingleRequest } from "@/lib/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

interface StepBody {
  run_id: number;
  endpoint_id: number;
  case_id: number;
  run_index: number;
  is_warmup: boolean;
}

export async function POST(req: Request) {
  const body = (await req.json()) as StepBody;

  const endpoint = await getEndpoint(body.endpoint_id);
  if (!endpoint) {
    return NextResponse.json({ error: `unknown endpoint id: ${body.endpoint_id}` }, { status: 404 });
  }
  const promptCase = await getCase(body.case_id);
  if (!promptCase) {
    return NextResponse.json({ error: `unknown case id: ${body.case_id}` }, { status: 404 });
  }

  const metrics = await runSingleRequest(endpoint, promptCase, body.run_index, body.is_warmup);
  const id = await saveResult(body.run_id, metrics);
  return NextResponse.json({ ...metrics, id });
}
