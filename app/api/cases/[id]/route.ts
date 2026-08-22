import { NextResponse } from "next/server";
import { deleteCase } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await deleteCase(Number(params.id));
  return NextResponse.json({ ok: true });
}
