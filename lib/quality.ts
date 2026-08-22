// Pluggable quality-check registry. Not wired into the GUI yet -- the
// criteria haven't been decided. Manual 1-5 star rating (db.setRating)
// covers the baseline quality signal for now. Register a check and hook
// it into the runner/API once you know what you want to check for
// (LLM-as-judge, embedding similarity, etc.).

type CheckFn = (text: string, params: Record<string, unknown>) => { passed: boolean; detail: string };

const registry = new Map<string, CheckFn>();

export function registerCheck(name: string, fn: CheckFn) {
  registry.set(name, fn);
}

export function runCheck(name: string, text: string, params: Record<string, unknown>) {
  const fn = registry.get(name);
  if (!fn) throw new Error(`unknown quality check: ${name}`);
  return fn(text, params);
}

export function availableChecks(): string[] {
  return [...registry.keys()].sort();
}

registerCheck("contains", (text, params) => {
  const needle = String(params.needle ?? "");
  const caseSensitive = Boolean(params.case_sensitive);
  const hay = caseSensitive ? text : text.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  const passed = hay.includes(n);
  return { passed, detail: `${passed ? "found" : "missing"}: ${JSON.stringify(needle)}` };
});

registerCheck("regex", (text, params) => {
  const pattern = String(params.pattern ?? "");
  const match = new RegExp(pattern).test(text);
  return { passed: match, detail: `pattern ${JSON.stringify(pattern)} ${match ? "matched" : "did not match"}` };
});

registerCheck("min_length", (text, params) => {
  const minChars = Number(params.min_chars ?? 0);
  const passed = text.length >= minChars;
  return { passed, detail: `length=${text.length}, min=${minChars}` };
});
