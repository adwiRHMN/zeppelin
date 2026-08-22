"""FastAPI app: CRUD for endpoints/cases, run execution over SSE, results
retrieval, and the static GUI. Run with:

    uvicorn app.main:app --reload --port 8420

or just `python -m app.main`.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from app import storage
from app.adapters.base import get_adapter
from app.config import settings
from app.metrics import summarize
from app.models import Endpoint, PromptCase, RequestMetrics, RunRequest
from app.runner import run_sequential

app = FastAPI(title="API Testing Kit")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@app.on_event("startup")
def _startup() -> None:
    storage.init_db()


# --- Endpoints -------------------------------------------------------

@app.get("/api/endpoints")
def api_list_endpoints() -> list[Endpoint]:
    return storage.list_endpoints()


@app.post("/api/endpoints")
def api_create_endpoint(e: Endpoint) -> Endpoint:
    e.id = storage.create_endpoint(e)
    return e


@app.delete("/api/endpoints/{endpoint_id}")
def api_delete_endpoint(endpoint_id: int) -> dict:
    storage.delete_endpoint(endpoint_id)
    return {"ok": True}


@app.post("/api/endpoints/{endpoint_id}/test")
async def api_test_endpoint(endpoint_id: int) -> dict:
    endpoint = storage.get_endpoint(endpoint_id)
    if endpoint is None:
        raise HTTPException(404, "endpoint not found")
    adapter = get_adapter(endpoint.adapter)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            models = await adapter.list_models(client, endpoint)
        return {"ok": True, "models": models}
    except Exception as exc:  # noqa: BLE001 - report any failure to the GUI, don't crash the request
        return {"ok": False, "error": str(exc)}


# --- Prompt cases ------------------------------------------------------

@app.get("/api/cases")
def api_list_cases() -> list[PromptCase]:
    return storage.list_cases()


@app.post("/api/cases")
def api_create_case(c: PromptCase) -> PromptCase:
    c.id = storage.create_case(c)
    return c


@app.delete("/api/cases/{case_id}")
def api_delete_case(case_id: int) -> dict:
    storage.delete_case(case_id)
    return {"ok": True}


# --- Runs ----------------------------------------------------------------

@app.get("/api/runs")
def api_list_runs() -> list[dict]:
    return storage.list_runs()


@app.get("/api/runs/{run_id}/results")
def api_run_results(run_id: int) -> dict:
    results = storage.list_results(run_id)
    metrics = [RequestMetrics(**{**r, "ok": bool(r["ok"]), "is_warmup": bool(r["is_warmup"])}) for r in results]
    by_key: dict[tuple[int, int], list[RequestMetrics]] = {}
    for m in metrics:
        by_key.setdefault((m.endpoint_id, m.case_id), []).append(m)
    summaries = [
        {"endpoint_id": ek, "case_id": ck, **summarize(group).as_dict()}
        for (ek, ck), group in by_key.items()
    ]
    return {"results": results, "summaries": summaries}


@app.post("/api/runs/start")
async def api_start_run(request: RunRequest):
    endpoints = {eid: storage.get_endpoint(eid) for eid in request.endpoint_ids}
    missing = [eid for eid, e in endpoints.items() if e is None]
    if missing:
        raise HTTPException(404, f"unknown endpoint ids: {missing}")

    cases = {cid: storage.get_case(cid) for cid in request.case_ids}
    missing_cases = [cid for cid, c in cases.items() if c is None]
    if missing_cases:
        raise HTTPException(404, f"unknown case ids: {missing_cases}")

    run_id = storage.create_run()

    async def event_stream():
        yield f"event: run_start\ndata: {json.dumps({'run_id': run_id})}\n\n"
        try:
            async for metrics in run_sequential(request, endpoints, cases):  # type: ignore[arg-type]
                storage.save_result(run_id, metrics)
                yield f"event: result\ndata: {metrics.model_dump_json()}\n\n"
                await asyncio.sleep(0)  # yield control so the client gets each event promptly
        except Exception as exc:  # noqa: BLE001 - surface run-level failures to the client instead of hanging the stream
            yield f"event: run_error\ndata: {json.dumps({'error': str(exc)})}\n\n"
        finally:
            yield f"event: run_done\ndata: {json.dumps({'run_id': run_id})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# --- Ratings -------------------------------------------------------------

@app.post("/api/results/{result_id}/rating")
def api_set_rating(result_id: int, rating: int, notes: str = "") -> dict:
    if not (1 <= rating <= 5):
        raise HTTPException(400, "rating must be 1-5")
    storage.set_rating(result_id, rating, notes)
    return {"ok": True}


# --- Static GUI ------------------------------------------------------

app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)
