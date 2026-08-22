import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/adapters/base";
import { getEndpoint } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const endpoint = await getEndpoint(Number(params.id));
  if (!endpoint) return NextResponse.json({ error: "endpoint not found" }, { status: 404 });

  const adapter = getAdapter(endpoint.adapter);
  try {
    const models = await adapter.listModels(endpoint);
    // Reaching the server is only half the check -- a configured model
    // name that isn't actually served will fail every run with a much
    // less obvious error, so flag it here instead.
    const modelFound = models.includes(endpoint.model);
    return NextResponse.json({ ok: true, models, model_found: modelFound });
  } catch (exc) {
    return NextResponse.json({ ok: false, error: String(exc) });
  }
}
