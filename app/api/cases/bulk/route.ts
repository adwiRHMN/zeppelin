// Bulk-create prompt cases from a JSON array, so a golden set of many
// bundles can be loaded in one shot instead of typed into the form
// individually.
import { NextResponse } from "next/server";
import { createCase } from "@/lib/db";
import type { PromptCase } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface BulkBody {
  cases: Partial<PromptCase>[];
}

export async function POST(req: Request) {
  const body = (await req.json()) as BulkBody;
  if (!Array.isArray(body.cases) || body.cases.length === 0) {
    return NextResponse.json({ error: "cases must be a non-empty array" }, { status: 400 });
  }

  const created: PromptCase[] = [];
  const errors: { index: number; error: string }[] = [];

  for (let i = 0; i < body.cases.length; i++) {
    const c = body.cases[i]!;
    if (!c.user_prompt) {
      errors.push({ index: i, error: "missing user_prompt" });
      continue;
    }
    try {
      const promptCase: PromptCase = {
        name: c.name || `case-${i}`,
        system_prompt: c.system_prompt || "",
        user_prompt: c.user_prompt,
        temperature: c.temperature ?? 0.7,
        max_tokens: c.max_tokens ?? null,
        seed: c.seed ?? null,
        json_schema: c.json_schema ?? null,
        input_data: c.input_data ?? null,
        faithfulness_check: c.faithfulness_check ?? false,
      };
      created.push(await createCase(promptCase));
    } catch (exc) {
      errors.push({ index: i, error: String(exc) });
    }
  }

  return NextResponse.json({ created, errors, created_count: created.length, error_count: errors.length });
}
