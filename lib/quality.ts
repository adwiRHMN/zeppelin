// Pluggable quality-check registry. Each check is a function from
// (response_text, params) -> {passed, detail}; registering one here makes
// it selectable from the runner without touching the run/API layer.

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

// --- baseline deterministic checks --------------------------------------

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

// --- faithfulness ---------------------------------------------------------
// Ported from the pattern described for Clarity's checkFaithfulness(): a
// pure, deterministic, offline check that every numeral the model output
// traces back to a value actually present in the input bundle. This is a
// reimplementation from a description, not the original source -- treat
// it as a reasonable approximation and calibrate against a few
// known-good/known-bad outputs before trusting it for a real decision.
//
// params: { bundle: unknown, allowEmpty?: boolean (default true) }

// The comma-grouped branch requires at least one comma group (`+`, not
// `*`) -- with `*` it would happily match just the leading 1-3 digits of
// a plain, comma-free number and leave the rest to match separately
// (e.g. "2026" matching as "202" then "6", "1328025" shredded into three
// pieces), which silently corrupts every plain multi-digit number.
const NUMERAL_RE = /-?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?%?|-?\d+(?:\.\d+)?%?/g;

function canonicalizeNumeral(raw: string): string {
  // Strip thousands separators and a trailing percent sign; keep the sign
  // and decimal point. "16,33,025" (Indian grouping) and "1,633,025"
  // (Western grouping) both canonicalize to "1633025".
  return raw.replace(/,/g, "").replace(/%$/, "");
}

/** Recursively collects every number in the bundle as its canonical
 * string form, plus a couple of formatting variants a model might
 * reasonably render it as, plus years pulled out of any date-like
 * strings (so "since 2026" traces against period: "2026-08").
 */
function collectAllowedNumerals(value: unknown, out: Set<string>): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    const s = String(value);
    out.add(s);
    // A fraction in [-1, 1] is often a rate stored as 0.234 but rendered
    // as a percentage "23.4%" -- allow both readings rather than flag a
    // legitimate percentage as a hallucinated number.
    if (value !== 0 && Math.abs(value) <= 1) {
      out.add(String(Math.round(value * 1000) / 10));
      out.add(String(Math.round(value * 10000) / 100));
    }
    // Common rendering: trailing .0 dropped, or rounded to fewer places.
    if (Number.isInteger(value)) out.add(String(value));
    else out.add(String(Math.round(value)));
    return;
  }
  if (typeof value === "string") {
    const dateMatch = value.match(/\b(19|20)\d{2}\b/);
    if (dateMatch) out.add(dateMatch[0]!);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectAllowedNumerals(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectAllowedNumerals(v, out);
  }
}

function looksEmpty(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.length === 0;
    if (parsed && typeof parsed === "object") {
      const values = Object.values(parsed);
      // Matches the common `{ "insights": [] }` shape: a single field
      // holding an empty array/string, or no fields at all.
      if (values.length === 0) return true;
      if (values.length === 1) {
        const v = values[0];
        if (Array.isArray(v) && v.length === 0) return true;
        if (typeof v === "string" && v.trim() === "") return true;
      }
    }
  } catch {
    // not JSON -- fall through to treating non-empty text as non-empty
  }
  return false;
}

registerCheck("faithfulness", (text, params) => {
  const allowEmpty = params.allowEmpty !== false;
  if (allowEmpty && looksEmpty(text)) {
    return { passed: true, detail: "empty result (allowed)" };
  }

  const bundle = params.bundle;
  if (bundle === undefined || bundle === null) {
    return { passed: false, detail: "no bundle provided to check against" };
  }

  const allowed = new Set<string>();
  collectAllowedNumerals(bundle, allowed);

  const found = text.match(NUMERAL_RE) ?? [];
  const unmatched: string[] = [];
  for (const raw of found) {
    const canon = canonicalizeNumeral(raw);
    if (!allowed.has(canon)) unmatched.push(raw);
  }

  const passed = unmatched.length === 0;
  const detail = passed
    ? `all ${found.length} numeral(s) traced to the bundle`
    : `${unmatched.length}/${found.length} numeral(s) not found in bundle: ${unmatched.slice(0, 8).join(", ")}`;
  return { passed, detail };
});
