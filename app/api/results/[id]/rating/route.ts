import { NextResponse } from "next/server";
import { setRating } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { rating, notes } = (await req.json()) as { rating: number; notes?: string };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "rating must be 1-5" }, { status: 400 });
  }
  await setRating(Number(params.id), rating, notes || "");
  return NextResponse.json({ ok: true });
}
