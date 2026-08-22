import { NextResponse } from "next/server";
import { createEndpoint, listEndpoints } from "@/lib/db";
import type { Endpoint } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await listEndpoints());
}

export async function POST(req: Request) {
  const body = (await req.json()) as Endpoint;
  if (!body.base_url || !body.model || !body.adapter) {
    return NextResponse.json({ error: "base_url, model, and adapter are required" }, { status: 400 });
  }
  const endpoint: Endpoint = {
    name: body.name || "unnamed",
    base_url: body.base_url,
    adapter: body.adapter,
    api_key: body.api_key || "",
    model: body.model,
  };
  return NextResponse.json(await createEndpoint(endpoint));
}
