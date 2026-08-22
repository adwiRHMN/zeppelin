// Creates an empty run row and hands back its id. The browser then calls
// /api/runs/step once per request to fill it in.
import { NextResponse } from "next/server";
import { createRun } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { label?: string };
  const runId = await createRun(body.label ?? "");
  return NextResponse.json({ run_id: runId });
}
