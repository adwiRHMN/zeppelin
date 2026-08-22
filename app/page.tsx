"use client";

import { Fragment, useEffect, useState } from "react";
import type { AdapterName, Endpoint, PromptCase, RequestMetrics, RunRow, RunSummary } from "@/lib/types";

type Tab = "endpoints" | "prompts" | "run" | "results";

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
  const [testStatus, setTestStatus] = useState<Record<number, string>>({});

  const add = async () => {
    if (!baseUrl || !model) return alert("Base URL and model are required.");
    await api("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || "unnamed", base_url: baseUrl, adapter, model, api_key: apiKey }),
    });
    setName(""); setBaseUrl(""); setModel(""); setApiKey("");
    refresh();
  };

  const test = async (id: number) => {
    setTestStatus((s) => ({ ...s, [id]: "Testing..." }));
    try {
      const res = await api<{ ok: boolean; models?: string[]; error?: string }>(`/api/endpoints/${id}/test`, { method: "POST" });
      setTestStatus((s) => ({ ...s, [id]: res.ok ? `OK (${res.models?.length ?? 0} models)` : "Failed: " + res.error }));
    } catch (e) {
      setTestStatus((s) => ({ ...s, [id]: "Failed" }));
    }
  };

  const del = async (id: number) => {
    await api(`/api/endpoints/${id}`, { method: "DELETE" });
    refresh();
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
          <thead><tr><th>Name</th><th>Base URL</th><th>Adapter</th><th>Model</th><th></th><th></th></tr></thead>
          <tbody>
            {endpoints.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td className="mono">{e.base_url}</td>
                <td>{e.adapter}</td>
                <td className="mono">{e.model}</td>
                <td><button className="ghost" onClick={() => test(e.id!)}>{testStatus[e.id!] || "Test"}</button></td>
                <td><button className="ghost" onClick={() => del(e.id!)}>Delete</button></td>
              </tr>
            ))}
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
  };

  const del = async (id: number) => {
    await api(`/api/cases/${id}`, { method: "DELETE" });
    refresh();
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

  const toggle = (set: Set<number>, setFn: (s: Set<number>) => void, id: number) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFn(next);
  };

  const start = async () => {
    if (selectedEndpoints.size === 0 || selectedCases.size === 0) {
      return alert("Pick at least one endpoint and one case.");
    }
    setRunning(true);
    setLog([]);
    try {
      const resp = await fetch("/api/runs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint_ids: [...selectedEndpoints],
          case_ids: [...selectedCases],
          repeats: parseInt(repeats, 10) || 1,
          warmup,
          delay_between_s: parseFloat(delay) || 0,
        }),
      });
      if (!resp.body) throw new Error("no response body");
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let runId: number | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";
        for (const chunk of chunks) {
          let event = "message";
          let data = "";
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) data = line.slice(5).trim();
          }
          if (!data) continue;
          const parsed = JSON.parse(data);
          if (event === "run_start") runId = parsed.run_id;
          else if (event === "result") setLog((l) => [...l, parsed]);
          else if (event === "run_error") console.error(parsed.error);
        }
      }
      if (runId != null) onRunComplete(runId);
    } catch (e) {
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
        <div>
          {log.map((m, i) => {
            const ep = endpoints.find((e) => e.id === m.endpoint_id);
            const c = cases.find((x) => x.id === m.case_id);
            return (
              <div key={i} className="progress-line">
                <span className={`pill ${m.ok ? "ok" : "err"}`}>{m.ok ? "ok" : "error"}</span>
                <b>{ep?.name ?? m.endpoint_id}</b> / {c?.name ?? m.case_id} #{m.run_index}
                ttft={fmt(m.ttft_s)}s total={fmt(m.total_s)}s tok/s={fmt(m.decode_tokens_per_s, 1)}
                {m.error_message && <span className="muted">{m.error_message}</span>}
              </div>
            );
          })}
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
