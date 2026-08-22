"use client";

import { Fragment, useEffect, useState } from "react";
import type { AdapterName, Endpoint, PromptCase, RequestMetrics, RunRow, RunSummary } from "@/lib/types";

type Tab = "endpoints" | "prompts" | "run" | "results";

interface ConnStatus {
  state: "checking" | "connected" | "model-missing" | "failed";
  detail: string;
}

const CONN_LABEL: Record<ConnStatus["state"], string> = {
  checking: "checking…",
  connected: "connected",
  "model-missing": "model missing",
  failed: "unreachable",
};

const CONN_PILL: Record<ConnStatus["state"], string> = {
  checking: "pill",
  connected: "pill ok",
  "model-missing": "pill warn",
  failed: "pill err",
};

function fmt(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined) return "-";
  return v.toFixed(digits);
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const resp = await fetch(path, opts);
  if (!resp.ok) throw new Error(`${resp.status}: ${await resp.text()}`);
  const ct = resp.headers.get("content-type") || "";
  return ct.includes("application/json") ? resp.json() : ((await resp.text()) as unknown as T);
}

export default function Page() {
  const [tab, setTab] = useState<Tab>("endpoints");
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [cases, setCases] = useState<PromptCase[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);

  const refreshEndpoints = () => api<Endpoint[]>("/api/endpoints").then(setEndpoints);
  const refreshCases = () => api<PromptCase[]>("/api/cases").then(setCases);
  const refreshRuns = () => api<RunRow[]>("/api/runs").then(setRuns);

  useEffect(() => {
    refreshEndpoints();
    refreshCases();
    refreshRuns();
  }, []);

  return (
    <>
      <header>
        <h1>API Testing Kit</h1>
        <nav>
          {(["endpoints", "prompts", "run", "results"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === "endpoints" && <EndpointsTab endpoints={endpoints} refresh={refreshEndpoints} />}
        {tab === "prompts" && <PromptsTab cases={cases} refresh={refreshCases} />}
        {tab === "run" && (
          <RunTab endpoints={endpoints} cases={cases} onRunComplete={(id) => { refreshRuns(); setTab("results"); }} />
        )}
        {tab === "results" && (
          <ResultsTab endpoints={endpoints} cases={cases} runs={runs} refreshRuns={refreshRuns} />
        )}
      </main>
    </>
  );
}

// --- Endpoints -----------------------------------------------------------

function EndpointsTab({ endpoints, refresh }: { endpoints: Endpoint[]; refresh: () => void }) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [adapter, setAdapter] = useState<AdapterName>("openai_compat");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [testStatus, setTestStatus] = useState<Record<number, ConnStatus>>({});

  // Check every endpoint's reachability on load, so the table shows real
  // connection state instead of leaving you to guess until a run fails.
  useEffect(() => {
    for (const e of endpoints) {
      if (e.id != null && testStatus[e.id] === undefined) test(e.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoints]);

  const add = async () => {
    if (!baseUrl || !model) return alert("Base URL and model are required.");
    try {
      await api("/api/endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || "unnamed", base_url: baseUrl, adapter, model, api_key: apiKey }),
      });
      setName(""); setBaseUrl(""); setModel(""); setApiKey("");
      refresh();
    } catch (e) {
      alert("Failed to add endpoint: " + (e as Error).message);
    }
  };

  const test = async (id: number) => {
    setTestStatus((s) => ({ ...s, [id]: { state: "checking", detail: "" } }));
    try {
      const res = await api<{ ok: boolean; models?: string[]; model_found?: boolean; error?: string }>(
        `/api/endpoints/${id}/test`,
        { method: "POST" }
      );
      if (!res.ok) {
        setTestStatus((s) => ({ ...s, [id]: { state: "failed", detail: res.error ?? "unknown error" } }));
      } else if (res.model_found === false) {
        // Server is reachable but won't serve the configured model --
        // worth its own state, since runs would fail with a far less
        // obvious error.
        setTestStatus((s) => ({
          ...s,
          [id]: { state: "model-missing", detail: `server OK, but model not found. Available: ${(res.models ?? []).join(", ") || "(none)"}` },
        }));
      } else {
        setTestStatus((s) => ({ ...s, [id]: { state: "connected", detail: `${res.models?.length ?? 0} models available` } }));
      }
    } catch (e) {
      setTestStatus((s) => ({ ...s, [id]: { state: "failed", detail: (e as Error).message } }));
    }
  };

  const del = async (id: number) => {
    try {
      await api(`/api/endpoints/${id}`, { method: "DELETE" });
      refresh();
    } catch (e) {
      alert("Failed to delete endpoint: " + (e as Error).message);
    }
  };

  return (
    <>
      <div className="panel">
        <h2>Add endpoint</h2>
        <div className="row">
          <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="OpenWebUI (via Tailscale)" /></div>
          <div className="field"><label>Base URL</label><input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-machine.ts.net" /></div>
          <div className="field">
            <label>Adapter</label>
            <select value={adapter} onChange={(e) => setAdapter(e.target.value as AdapterName)}>
              <option value="openai_compat">OpenAI-compatible (OpenWebUI / v1)</option>
              <option value="ollama_native">Ollama native</option>
            </select>
          </div>
          <div className="field"><label>Model</label><input value={model} onChange={(e) => setModel(e.target.value)} placeholder="llama3.1:8b" /></div>
          <div className="field"><label>API key (optional)</label><input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></div>
          <button className="primary" onClick={add}>Add</button>
        </div>
      </div>
      <div className="panel">
        <div className="toolbar"><h2>Endpoints</h2></div>
        <table>
          <thead><tr><th>Name</th><th>Base URL</th><th>Adapter</th><th>Model</th><th>Status</th><th></th><th></th></tr></thead>
          <tbody>
            {!endpoints.length && (
              <tr><td colSpan={7} className="muted">No endpoints yet. Add one above.</td></tr>
            )}
            {endpoints.map((e) => {
              const st = testStatus[e.id!];
              return (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td className="mono">{e.base_url}</td>
                  <td>{e.adapter}</td>
                  <td className="mono">{e.model}</td>
                  <td>
                    {st ? (
                      <span className={CONN_PILL[st.state]} title={st.detail}>{CONN_LABEL[st.state]}</span>
                    ) : (
                      <span className="pill">not checked</span>
                    )}
                    {st && st.state !== "checking" && st.detail && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{st.detail}</div>
                    )}
                  </td>
                  <td><button className="ghost" onClick={() => test(e.id!)}>Recheck</button></td>
                  <td><button className="ghost" onClick={() => del(e.id!)}>Delete</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// --- Prompts -------------------------------------------------------------

function PromptsTab({ cases, refresh }: { cases: PromptCase[]; refresh: () => void }) {
  const [name, setName] = useState("");
  const [system, setSystem] = useState("");
  const [user, setUser] = useState("");
  const [temp, setTemp] = useState("0.7");
  const [maxTokens, setMaxTokens] = useState("");
  const [seed, setSeed] = useState("");

  const add = async () => {
    if (!user) return alert("User prompt is required.");
    try {
      await api("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || "unnamed",
          system_prompt: system,
          user_prompt: user,
          temperature: parseFloat(temp) || 0.7,
          max_tokens: maxTokens ? parseInt(maxTokens, 10) : null,
          seed: seed ? parseInt(seed, 10) : null,
        }),
      });
      setName(""); setSystem(""); setUser(""); setMaxTokens(""); setSeed("");
      refresh();
    } catch (e) {
      alert("Failed to add prompt case: " + (e as Error).message);
    }
  };

  const del = async (id: number) => {
    try {
      await api(`/api/cases/${id}`, { method: "DELETE" });
      refresh();
    } catch (e) {
      alert("Failed to delete prompt case: " + (e as Error).message);
    }
  };

  return (
    <>
      <div className="panel">
        <h2>Add prompt case</h2>
        <div className="row">
          <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="short-factual" /></div>
          <div className="field"><label>Temperature</label><input type="number" step="0.1" value={temp} onChange={(e) => setTemp(e.target.value)} /></div>
          <div className="field"><label>Max tokens</label><input type="number" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="(server default)" /></div>
          <div className="field"><label>Seed</label><input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="(none)" /></div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <div className="field"><label>System prompt (optional)</label><textarea value={system} onChange={(e) => setSystem(e.target.value)} /></div>
          <div className="field"><label>User prompt</label><textarea value={user} onChange={(e) => setUser(e.target.value)} /></div>
        </div>
        <div className="row" style={{ marginTop: 8 }}><button className="primary" onClick={add}>Add case</button></div>
      </div>
      <div className="panel">
        <h2>Prompt cases</h2>
        <table>
          <thead><tr><th>Name</th><th>Prompt</th><th>Temp</th><th></th></tr></thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="mono">{c.user_prompt.length > 60 ? c.user_prompt.slice(0, 60) + "…" : c.user_prompt}</td>
                <td className="num">{c.temperature}</td>
                <td><button className="ghost" onClick={() => del(c.id!)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// --- Run ----------------------------------------------------------------

function RunTab({
  endpoints,
  cases,
  onRunComplete,
}: {
  endpoints: Endpoint[];
  cases: PromptCase[];
  onRunComplete: (runId: number) => void;
}) {
  const [selectedEndpoints, setSelectedEndpoints] = useState<Set<number>>(new Set());
  const [selectedCases, setSelectedCases] = useState<Set<number>>(new Set());
  const [repeats, setRepeats] = useState("3");
  const [delay, setDelay] = useState("0");
  const [warmup, setWarmup] = useState(true);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<RequestMetrics[]>([]);
  const [status, setStatus] = useState("");
  const [elapsed, setElapsed] = useState(0);

  // Tick an elapsed-seconds counter while a run is in flight. Without it
  // there's no sign of life during a slow first request -- a cold model
  // can take a minute before its first token arrives.
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);

  const toggle = (set: Set<number>, setFn: (s: Set<number>) => void, id: number) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFn(next);
  };

  const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

  const start = async () => {
    if (selectedEndpoints.size === 0 || selectedCases.size === 0) {
      return alert("Pick at least one endpoint and one case.");
    }

    // Build the full plan up front, then walk it one HTTP call at a time.
    // Keeping the loop here rather than server-side is what makes this
    // work on Vercel Hobby: each /api/runs/step invocation only has to
    // outlive a single LLM request, not the whole batch.
    const n = parseInt(repeats, 10) || 1;
    const delayS = parseFloat(delay) || 0;
    const plan: { endpoint_id: number; case_id: number; run_index: number; is_warmup: boolean }[] = [];
    for (const endpointId of selectedEndpoints) {
      for (const caseId of selectedCases) {
        if (warmup) plan.push({ endpoint_id: endpointId, case_id: caseId, run_index: -1, is_warmup: true });
        for (let i = 0; i < n; i++) {
          plan.push({ endpoint_id: endpointId, case_id: caseId, run_index: i, is_warmup: false });
        }
      }
    }

    setRunning(true);
    setLog([]);
    setStatus("Creating run…");

    let runId: number | null = null;
    try {
      const created = await api<{ run_id: number }>("/api/runs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      runId = created.run_id;

      for (let i = 0; i < plan.length; i++) {
        const step = plan[i]!;
        setStatus(
          `Run #${runId} — request ${i + 1} of ${plan.length}` +
            (step.is_warmup ? " (warmup, cold models can take a while)…" : "…")
        );
        try {
          const metrics = await api<RequestMetrics>("/api/runs/step", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ run_id: runId, ...step }),
          });
          setLog((l) => [...l, metrics]);
        } catch (e) {
          // One failed step shouldn't abandon the rest of the run --
          // record it and keep going.
          setLog((l) => [
            ...l,
            {
              endpoint_id: step.endpoint_id, case_id: step.case_id, run_index: step.run_index,
              is_warmup: step.is_warmup, ok: false, error_message: (e as Error).message,
              ttft_s: null, total_s: null, prompt_tokens: null, completion_tokens: null,
              decode_tokens_per_s: null, server_load_s: null, server_prompt_eval_s: null,
              server_eval_s: null, server_total_s: null, proxy_overhead_s: null,
              response_text: "", rating: null, rating_notes: "",
            } as RequestMetrics,
          ]);
        }
        if (delayS && i < plan.length - 1) await sleep(delayS);
      }

      setStatus(`Run #${runId} complete — ${plan.length} requests.`);
      if (runId != null) onRunComplete(runId);
    } catch (e) {
      setStatus("Run failed: " + (e as Error).message);
      alert("Run failed: " + (e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="panel">
        <h2>Configure run</h2>
        <div className="row">
          <div className="field">
            <label>Endpoints</label>
            <div className="checklist">
              {endpoints.length === 0 && <span className="muted">No endpoints yet.</span>}
              {endpoints.map((e) => (
                <label key={e.id}>
                  <input type="checkbox" checked={selectedEndpoints.has(e.id!)} onChange={() => toggle(selectedEndpoints, setSelectedEndpoints, e.id!)} />
                  {e.name} ({e.model})
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Prompt cases</label>
            <div className="checklist">
              {cases.length === 0 && <span className="muted">No prompt cases yet.</span>}
              {cases.map((c) => (
                <label key={c.id}>
                  <input type="checkbox" checked={selectedCases.has(c.id!)} onChange={() => toggle(selectedCases, setSelectedCases, c.id!)} />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="field"><label>Repeats</label><input type="number" min={1} max={100} value={repeats} onChange={(e) => setRepeats(e.target.value)} /></div>
          <div className="field"><label>Delay between requests (s)</label><input type="number" step="0.1" value={delay} onChange={(e) => setDelay(e.target.value)} /></div>
          <div className="field">
            <label>Warmup request</label>
            <select value={warmup ? "true" : "false"} onChange={(e) => setWarmup(e.target.value === "true")}>
              <option value="true">Yes (excluded from stats)</option>
              <option value="false">No</option>
            </select>
          </div>
          <button className="primary" onClick={start} disabled={running}>{running ? "Running..." : "Start run"}</button>
        </div>
      </div>
      <div className="panel">
        <h2>Live progress</h2>
        {(status || running) && (
          <div className="progress-line">
            {running && <span className="pill ok">running</span>}
            <span>{status}</span>
            {running && <span className="muted">{elapsed}s elapsed</span>}
          </div>
        )}
        <div>
          {log.map((m, i) => {
            const ep = endpoints.find((e) => e.id === m.endpoint_id);
            const c = cases.find((x) => x.id === m.case_id);
            return (
              <div key={i} className="progress-line">
                <span className={`pill ${m.ok ? "ok" : "err"}`}>{m.ok ? "ok" : "error"}</span>
                {m.is_warmup && <span className="pill">warmup</span>}
                <b>{ep?.name ?? m.endpoint_id}</b> / {c?.name ?? m.case_id}
                {!m.is_warmup && ` #${m.run_index}`}
                {" "}ttft={fmt(m.ttft_s)}s total={fmt(m.total_s)}s tok/s={fmt(m.decode_tokens_per_s, 1)}
                {m.error_message && <span className="muted">{m.error_message}</span>}
              </div>
            );
          })}
          {!log.length && !running && !status && (
            <span className="muted">No run yet. Configure above and hit Start run.</span>
          )}
        </div>
      </div>
    </>
  );
}

// --- Results --------------------------------------------------------

function ResultsTab({
  endpoints,
  cases,
  runs,
  refreshRuns,
}: {
  endpoints: Endpoint[];
  cases: PromptCase[];
  runs: RunRow[];
  refreshRuns: () => void;
}) {
  const [runId, setRunId] = useState<number | null>(null);
  const [results, setResults] = useState<RequestMetrics[]>([]);
  const [summaries, setSummaries] = useState<RunSummary[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (runId == null && runs.length > 0) setRunId(runs[0]!.id);
  }, [runs, runId]);

  const load = async (id: number) => {
    const data = await api<{ results: RequestMetrics[]; summaries: RunSummary[] }>(`/api/runs/${id}/results`);
    setResults(data.results);
    setSummaries(data.summaries);
  };

  useEffect(() => {
    if (runId != null) load(runId);
  }, [runId]);

  const rate = async (resultId: number, rating: number) => {
    await api(`/api/results/${resultId}/rating`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, notes: "" }),
    });
    if (runId != null) load(runId);
  };

  const toggleExpand = (id: number) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  const exportCsv = () => {
    if (!results.length) return;
    const cols = [
      "id", "endpoint_id", "case_id", "run_index", "is_warmup", "ok", "error_message",
      "ttft_s", "total_s", "prompt_tokens", "completion_tokens", "decode_tokens_per_s",
      "server_load_s", "server_prompt_eval_s", "server_eval_s", "server_total_s", "proxy_overhead_s",
      "rating", "rating_notes",
    ] as const;
    const lines = [cols.join(",")];
    for (const r of results) {
      lines.push(cols.map((c) => JSON.stringify((r as any)[c] ?? "")).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `run-${runId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const detailRows = results.filter((r) => !r.is_warmup);

  return (
    <>
      <div className="panel">
        <div className="row">
          <div className="field">
            <label>Run</label>
            <select value={runId ?? ""} onChange={(e) => setRunId(Number(e.target.value))}>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>Run #{r.id} — {r.created_at}</option>
              ))}
            </select>
          </div>
          <button className="ghost" onClick={() => { refreshRuns(); if (runId != null) load(runId); }}>Refresh</button>
          <button className="ghost" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>
      <div className="panel">
        <h2>Summary (per endpoint × case)</h2>
        <table>
          <thead><tr>
            <th>Endpoint</th><th>Case</th><th>N</th><th>Errors</th>
            <th>TTFT p50</th><th>TTFT p95</th><th>Total p50</th><th>Total p95</th><th>Tok/s</th>
          </tr></thead>
          <tbody>
            {summaries.map((s, i) => {
              const ep = endpoints.find((e) => e.id === s.endpoint_id);
              const c = cases.find((x) => x.id === s.case_id);
              return (
                <tr key={i}>
                  <td>{ep?.name ?? s.endpoint_id}</td>
                  <td>{c?.name ?? s.case_id}</td>
                  <td className="num">{s.n}</td>
                  <td className="num">{s.n_error}</td>
                  <td className="num">{fmt(s.ttft_p50)}</td>
                  <td className="num">{fmt(s.ttft_p95)}</td>
                  <td className="num">{fmt(s.total_p50)}</td>
                  <td className="num">{fmt(s.total_p95)}</td>
                  <td className="num">{fmt(s.decode_tps_mean, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h2>Individual requests</h2>
        <table>
          <thead><tr>
            <th>#</th><th>Status</th><th>TTFT</th><th>Total</th><th>Tok/s</th><th>Rating</th><th></th>
          </tr></thead>
          <tbody>
            {detailRows.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td className="num">{r.run_index}</td>
                  <td>{r.ok ? <span className="pill ok">ok</span> : <span className="pill err" title={r.error_message}>error</span>}</td>
                  <td className="num">{fmt(r.ttft_s)}</td>
                  <td className="num">{fmt(r.total_s)}</td>
                  <td className="num">{fmt(r.decode_tokens_per_s, 1)}</td>
                  <td>
                    <div className="stars">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n} className={r.rating && n <= r.rating ? "filled" : ""} onClick={() => rate(r.id!, n)}>★</span>
                      ))}
                    </div>
                  </td>
                  <td><button className="ghost" onClick={() => toggleExpand(r.id!)}>View</button></td>
                </tr>
                {expanded.has(r.id!) && (
                  <tr>
                    <td colSpan={7}><div className="response-preview">{r.response_text}</div></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
