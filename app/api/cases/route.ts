import { NextResponse } from "next/server";
import { createCase, listCases } from "@/lib/db";
import type { PromptCase } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await listCases());
}

export async function POST(req: Request) {
  const body = (await req.json()) as PromptCase;
  if (!body.user_prompt) {
    return NextResponse.json({ error: "user_prompt is required" }, { status: 400 });
  }
  const promptCase: PromptCase = {
    name: body.name || "unnamed",
    system_prompt: body.system_prompt || "",
    user_prompt: body.user_prompt,
    temperature: body.temperature ?? 0.7,
    max_tokens: body.max_tokens ?? null,
    seed: body.seed ?? null,
  };
  return NextResponse.json(await createCase(promptCase));
}
