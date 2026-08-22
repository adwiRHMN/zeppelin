import { NextResponse } from "next/server";
import { deleteEndpoint } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await deleteEndpoint(Number(params.id));
  return NextResponse.json({ ok: true });
}
