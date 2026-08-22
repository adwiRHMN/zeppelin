import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/adapters/base";
import { getEndpoint } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const endpoint = await getEndpoint(Number(params.id));
  if (!endpoint) return NextResponse.json({ error: "endpoint not found" }, { status: 404 });

  const adapter = getAdapter(endpoint.adapter);
  try {
    const models = await adapter.listModels(endpoint);
    return NextResponse.json({ ok: true, models });
  } catch (exc) {
    return NextResponse.json({ ok: false, error: String(exc) });
  }
}
