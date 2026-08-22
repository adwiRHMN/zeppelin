// Streams run progress as SSE while persisting each result to Postgres as
// it completes. Runs on the Node runtime (not Edge) since @vercel/postgres
// and the adapters both need it. maxDuration is set to the Pro plan's cap
// (300s) -- on Hobby the platform caps it at 60s regardless, so keep
// repeats * (endpoints * cases) modest there or the stream gets cut off
// mid-run. Results already written before a timeout are not lost; only
// the remainder of the batch doesn't happen.

import { getCase, getEndpoint, createRun, saveResult } from "@/lib/db";
import { runSequential } from "@/lib/runner";
import type { Endpoint, PromptCase, RunRequest } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json()) as RunRequest;

  const endpoints = new Map<number, Endpoint>();
  for (const id of body.endpoint_ids) {
    const e = await getEndpoint(id);
    if (!e) return Response.json({ error: `unknown endpoint id: ${id}` }, { status: 404 });
    endpoints.set(id, e);
  }

  const cases = new Map<number, PromptCase>();
  for (const id of body.case_ids) {
    const c = await getCase(id);
    if (!c) return Response.json({ error: `unknown case id: ${id}` }, { status: 404 });
    cases.set(id, c);
  }

  const runId = await createRun();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("run_start", { run_id: runId });
      try {
        for await (const metrics of runSequential(body, endpoints, cases)) {
          await saveResult(runId, metrics);
          send("result", metrics);
        }
      } catch (exc) {
        send("run_error", { error: String(exc) });
      } finally {
        send("run_done", { run_id: runId });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
