import { NextResponse } from "next/server";
import { listResults } from "@/lib/db";
import { summarizeAll } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const results = await listResults(Number(params.id));
  const summaries = summarizeAll(results);
  return NextResponse.json({ results, summaries });
}
