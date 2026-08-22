// Plain vanilla JS, no build step. State lives in a few module-level
// arrays refreshed from the API; each tab renders from that state.

let endpoints = [];
let cases = [];
let runs = [];
let currentRunId = null;
let currentResults = [];

// --- tabs -----------------------------------------------------------

document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "run") renderRunChecklists();
    if (btn.dataset.tab === "results") refreshRunsDropdown();
  });
});

// --- helpers ----------------------------------------------------------

function fmt(v, digits = 3) {
  if (v === null || v === undefined) return "-";
  return Number(v).toFixed(digits);
}

async function api(path, opts) {
  const resp = await fetch(path, opts);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`${resp.status}: ${body}`);
  }
  const ct = resp.headers.get("content-type") || "";
  return ct.includes("application/json") ? resp.json() : resp.text();
}

// --- Endpoints ----------------------------------------------------------

async function loadEndpoints() {
  endpoints = await api("/api/endpoints");
  renderEndpoints();
}

function renderEndpoints() {
  const tbody = document.getElementById("ep-list");
  tbody.innerHTML = "";
  for (const e of endpoints) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e.name}</td>
      <td class="mono">${e.base_url}</td>
      <td>${e.adapter}</td>
      <td class="mono">${e.model}</td>
      <td><button class="ghost" data-test="${e.id}">Test</button></td>
      <td><button class="ghost" data-del="${e.id}">Delete</button></td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("[data-test]").forEach((btn) =>
    btn.addEventListener("click", () => testEndpoint(btn.dataset.test, btn))
  );
  tbody.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api(`/api/endpoints/${btn.dataset.del}`, { method: "DELETE" });
      loadEndpoints();
    })
  );
}

async function testEndpoint(id, btn) {
  btn.textContent = "Testing...";
  try {
    const res = await api(`/api/endpoints/${id}/test`, { method: "POST" });
    btn.textContent = res.ok ? `OK (${res.models.length} models)` : "Failed";
    if (!res.ok) console.error(res.error);
  } catch (e) {
    btn.textContent = "Failed";
    console.error(e);
  }
  setTimeout(() => (btn.textContent = "Test"), 2500);
}

document.getElementById("ep-add").addEventListener("click", async () => {
  const body = {
    name: document.getElementById("ep-name").value || "unnamed",
    base_url: document.getElementById("ep-url").value,
    adapter: document.getElementById("ep-adapter").value,
    model: document.getElementById("ep-model").value,
    api_key: document.getElementById("ep-key").value,
  };
  if (!body.base_url || !body.model) return alert("Base URL and model are required.");
  await api("/api/endpoints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  document.getElementById("ep-name").value = "";
  document.getElementById("ep-url").value = "";
  document.getElementById("ep-model").value = "";
  document.getElementById("ep-key").value = "";
  loadEndpoints();
});

// --- Prompt cases ------------------------------------------------------

async function loadCases() {
  cases = await api("/api/cases");
  renderCases();
}

function renderCases() {
  const tbody = document.getElementById("case-list");
  tbody.innerHTML = "";
  for (const c of cases) {
    const tr = document.createElement("tr");
    const preview = c.user_prompt.length > 60 ? c.user_prompt.slice(0, 60) + "…" : c.user_prompt;
    tr.innerHTML = `
      <td>${c.name}</td>
      <td class="mono">${preview}</td>
      <td class="num">${c.temperature}</td>
      <td><button class="ghost" data-del="${c.id}">Delete</button></td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api(`/api/cases/${btn.dataset.del}`, { method: "DELETE" });
      loadCases();
    })
  );
}

document.getElementById("case-add").addEventListener("click", async () => {
  const maxTokensRaw = document.getElementById("case-max-tokens").value;
  const seedRaw = document.getElementById("case-seed").value;
  const body = {
    name: document.getElementById("case-name").value || "unnamed",
    system_prompt: document.getElementById("case-system").value,
    user_prompt: document.getElementById("case-user").value,
    temperature: parseFloat(document.getElementById("case-temp").value) || 0.7,
    max_tokens: maxTokensRaw ? parseInt(maxTokensRaw, 10) : null,
    seed: seedRaw ? parseInt(seedRaw, 10) : null,
  };
  if (!body.user_prompt) return alert("User prompt is required.");
  await api("/api/cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  document.getElementById("case-name").value = "";
  document.getElementById("case-system").value = "";
  document.getElementById("case-user").value = "";
  document.getElementById("case-max-tokens").value = "";
  document.getElementById("case-seed").value = "";
  loadCases();
});

// --- Run ----------------------------------------------------------------

function renderRunChecklists() {
  const epDiv = document.getElementById("run-endpoints");
  epDiv.innerHTML = endpoints
    .map((e) => `<label><input type="checkbox" value="${e.id}" class="run-ep-cb"> ${e.name} (${e.model})</label>`)
    .join("") || '<span class="muted">No endpoints yet.</span>';

  const caseDiv = document.getElementById("run-cases");
  caseDiv.innerHTML = cases
    .map((c) => `<label><input type="checkbox" value="${c.id}" class="run-case-cb"> ${c.name}</label>`)
    .join("") || '<span class="muted">No prompt cases yet.</span>';
}

document.getElementById("run-start").addEventListener("click", startRun);

async function startRun() {
  const endpointIds = [...document.querySelectorAll(".run-ep-cb:checked")].map((cb) => parseInt(cb.value, 10));
  const caseIds = [...document.querySelectorAll(".run-case-cb:checked")].map((cb) => parseInt(cb.value, 10));
  if (!endpointIds.length || !caseIds.length) return alert("Pick at least one endpoint and one case.");

  const body = {
    endpoint_ids: endpointIds,
    case_ids: caseIds,
    repeats: parseInt(document.getElementById("run-repeats").value, 10) || 1,
    warmup: document.getElementById("run-warmup").value === "true",
    delay_between_s: parseFloat(document.getElementById("run-delay").value) || 0,
  };

  const log = document.getElementById("run-log");
  log.innerHTML = "";
  const startBtn = document.getElementById("run-start");
  startBtn.disabled = true;
  startBtn.textContent = "Running...";

  try {
    const resp = await fetch("/api/runs/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let runId = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const chunks = buf.split("\n\n");
      buf = chunks.pop();
      for (const chunk of chunks) {
        const lines = chunk.split("\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data = line.slice(5).trim();
        }
        if (!data) continue;
        const parsed = JSON.parse(data);
        if (event === "run_start") {
          runId = parsed.run_id;
        } else if (event === "result") {
          appendRunLog(parsed);
        } else if (event === "run_error") {
          const div = document.createElement("div");
          div.className = "progress-line";
          div.innerHTML = `<span class="pill err">RUN ERROR</span> ${parsed.error}`;
          log.appendChild(div);
        }
      }
    }

    currentRunId = runId;
    await loadRuns();
    document.getElementById("results-run").value = runId;
  } catch (e) {
    alert("Run failed: " + e.message);
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "Start run";
  }
}

function appendRunLog(m) {
  const ep = endpoints.find((e) => e.id === m.endpoint_id);
  const c = cases.find((x) => x.id === m.case_id);
  const div = document.createElement("div");
  div.className = "progress-line";
  const status = m.ok ? '<span class="pill ok">ok</span>' : `<span class="pill err">error</span>`;
  div.innerHTML = `${status} <b>${ep ? ep.name : m.endpoint_id}</b> / ${c ? c.name : m.case_id} #${m.run_index}
    ttft=${fmt(m.ttft_s)}s total=${fmt(m.total_s)}s tok/s=${fmt(m.decode_tokens_per_s, 1)}
    ${m.error_message ? `<span class="muted">${m.error_message}</span>` : ""}`;
  document.getElementById("run-log").appendChild(div);
  div.scrollIntoView({ block: "nearest" });
}

// --- Results --------------------------------------------------------

async function loadRuns() {
  runs = await api("/api/runs");
}

async function refreshRunsDropdown() {
  await loadRuns();
  const sel = document.getElementById("results-run");
  const prev = sel.value;
  sel.innerHTML = runs.map((r) => `<option value="${r.id}">Run #${r.id} — ${r.created_at}</option>`).join("");
  if (prev) sel.value = prev;
  else if (currentRunId) sel.value = currentRunId;
  if (sel.value) loadResults(sel.value);
}

document.getElementById("results-run").addEventListener("change", (e) => loadResults(e.target.value));
document.getElementById("results-refresh").addEventListener("click", () => {
  const id = document.getElementById("results-run").value;
  if (id) loadResults(id);
});

async function loadResults(runId) {
  const data = await api(`/api/runs/${runId}/results`);
  currentResults = data.results;
  renderSummary(data.summaries);
  renderDetail(data.results);
}

function renderSummary(summaries) {
  const tbody = document.getElementById("results-summary");
  tbody.innerHTML = summaries
    .map((s) => {
      const ep = endpoints.find((e) => e.id === s.endpoint_id);
      const c = cases.find((x) => x.id === s.case_id);
      return `<tr>
        <td>${ep ? ep.name : s.endpoint_id}</td>
        <td>${c ? c.name : s.case_id}</td>
        <td class="num">${s.n}</td>
        <td class="num">${s.n_error}</td>
        <td class="num">${fmt(s.ttft_p50)}</td>
        <td class="num">${fmt(s.ttft_p95)}</td>
        <td class="num">${fmt(s.total_p50)}</td>
        <td class="num">${fmt(s.total_p95)}</td>
        <td class="num">${fmt(s.decode_tps_mean, 1)}</td>
      </tr>`;
    })
    .join("");
}

function renderDetail(results) {
  const tbody = document.getElementById("results-detail");
  tbody.innerHTML = results
    .filter((r) => !r.is_warmup)
    .map((r) => {
      const stars = [1, 2, 3, 4, 5]
        .map((n) => `<span data-star="${n}" class="${r.rating && n <= r.rating ? "filled" : ""}">★</span>`)
        .join("");
      return `<tr data-id="${r.id}">
        <td class="num">${r.run_index}</td>
        <td>${r.ok ? '<span class="pill ok">ok</span>' : `<span class="pill err" title="${r.error_message}">error</span>`}</td>
        <td class="num">${fmt(r.ttft_s)}</td>
        <td class="num">${fmt(r.total_s)}</td>
        <td class="num">${fmt(r.decode_tokens_per_s, 1)}</td>
        <td><div class="stars" data-id="${r.id}">${stars}</div></td>
        <td><button class="ghost" data-view="${r.id}">View</button></td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".stars").forEach((el) => {
    el.querySelectorAll("span").forEach((star) => {
      star.addEventListener("click", async () => {
        const rating = parseInt(star.dataset.star, 10);
        const resultId = el.dataset.id;
        await api(`/api/results/${resultId}/rating?rating=${rating}&notes=`, { method: "POST" });
        const id = document.getElementById("results-run").value;
        loadResults(id);
      });
    });
  });

  tbody.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const result = currentResults.find((r) => String(r.id) === btn.dataset.view);
      const row = btn.closest("tr");
      let existing = row.nextElementSibling;
      if (existing && existing.classList.contains("preview-row")) {
        existing.remove();
        return;
      }
      const previewRow = document.createElement("tr");
      previewRow.className = "preview-row";
      const td = document.createElement("td");
      td.colSpan = 7;
      td.innerHTML = `<div class="response-preview">${escapeHtml(result.response_text)}</div>`;
      previewRow.appendChild(td);
      row.after(previewRow);
    });
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

document.getElementById("results-export").addEventListener("click", () => {
  if (!currentResults.length) return;
  const cols = [
    "id", "endpoint_id", "case_id", "run_index", "is_warmup", "ok", "error_message",
    "ttft_s", "total_s", "prompt_tokens", "completion_tokens", "decode_tokens_per_s",
    "server_load_s", "server_prompt_eval_s", "server_eval_s", "server_total_s", "proxy_overhead_s",
    "rating", "rating_notes",
  ];
  const lines = [cols.join(",")];
  for (const r of currentResults) {
    lines.push(cols.map((c) => JSON.stringify(r[c] ?? "")).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `run-${document.getElementById("results-run").value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// --- init -----------------------------------------------------------

(async function init() {
  await Promise.all([loadEndpoints(), loadCases()]);
  renderRunChecklists();
  await refreshRunsDropdown();
})();
