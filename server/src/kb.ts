// Open IPSIE-control knowledge base (EPIC-MOAT). Two layers:
//   1. repo files under kb/*.json — community-contributable seed/verified facts;
//   2. Store overrides — human verify/override + agent proposals at runtime.
// Merge precedence per control: a human-verified fact (either layer) wins; else
// the Store override; else the repo file. Only HUMAN-verified facts are injected
// into the agent as trusted priors (see agent.ts). All loaded text is sanitized
// and every citation URL is re-checked with safeUrl(), so a malformed or hostile
// KB file cannot inject prompt content or unsafe links.
import { promises as fs } from "fs";
import path from "path";
import { CONTROLS, ControlKey, Verdict, ControlFact, KbVendor } from "./controls";
import { store } from "./store";
import { safeUrl, sanitizeField } from "./security/sanitize";

const VALID_VERDICTS: Verdict[] = ["supported", "partial", "unsupported", "unknown"];
const CONTROL_KEYS = CONTROLS.map((c) => c.key) as ControlKey[];

export function slug(s: string): string {
  return String(s || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function hostFromUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, "") || null; } catch { return null; }
}

/** Resolve an assess input to a KB key (a domain when we have one, else a vendor slug). */
export function kbKeyFor(input: { url?: string; vendor?: string; name?: string }): string {
  return hostFromUrl(input.url) || vendorSlugIndex.get(slug(input.vendor || input.name || "")) || slug(input.vendor || input.name || "");
}

// --- repo file layer -------------------------------------------------------

let fileCache: Map<string, KbVendor> | null = null;     // domain -> vendor record
const vendorSlugIndex = new Map<string, string>();       // slug(vendor) -> domain

function kbDirCandidates(): string[] {
  return [
    process.env.KB_DIR,
    path.resolve(process.cwd(), "kb"),
    path.resolve(process.cwd(), "..", "kb"),
    path.resolve(__dirname, "..", "..", "kb"),
    path.resolve(__dirname, "..", "..", "..", "kb"),
  ].filter((p): p is string => !!p);
}

/** Sanitize + bound one fact loaded from disk/JSON; returns null if unusable. */
function cleanFact(raw: any): ControlFact | null {
  if (!raw || typeof raw !== "object") return null;
  const verdict = (VALID_VERDICTS.includes(raw.verdict) ? raw.verdict : "unknown") as Verdict;
  const source = (["human", "agent", "seed"].includes(raw.source) ? raw.source : "seed") as ControlFact["source"];
  const confidence = typeof raw.confidence === "number" && isFinite(raw.confidence) ? Math.max(0, Math.min(1, raw.confidence)) : 0.5;
  const citations = (Array.isArray(raw.citations) ? raw.citations : [])
    .map((c: any) => ({ title: sanitizeField(c?.title, 160), url: safeUrl(c?.url) || "" }))
    .filter((c: any) => c.url || c.title)
    .slice(0, 3);
  return {
    verdict,
    confidence,
    standards: (Array.isArray(raw.standards) ? raw.standards : []).map((s: any) => sanitizeField(s, 40)).filter(Boolean).slice(0, 8),
    summary: sanitizeField(raw.summary, 600),
    citations,
    source,
    verifiedBy: raw.verifiedBy ? sanitizeField(raw.verifiedBy, 80) : undefined,
    verifiedAt: raw.verifiedAt ? sanitizeField(raw.verifiedAt, 40) : undefined,
  };
}

/** Validate a raw KB file object; returns a list of human-readable errors (empty = ok). */
export function validateKbFile(raw: any): string[] {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return ["not an object"];
  if (!raw.domain || typeof raw.domain !== "string") errors.push("missing 'domain'");
  if (!raw.vendor || typeof raw.vendor !== "string") errors.push("missing 'vendor'");
  if (!raw.controls || typeof raw.controls !== "object") errors.push("missing 'controls'");
  for (const [k, v] of Object.entries(raw.controls || {})) {
    if (!CONTROL_KEYS.includes(k as ControlKey)) errors.push(`unknown control '${k}'`);
    if (!v || !VALID_VERDICTS.includes((v as any).verdict)) errors.push(`control '${k}': invalid/missing verdict`);
  }
  return errors;
}

async function loadFiles(): Promise<Map<string, KbVendor>> {
  if (fileCache) return fileCache;
  const map = new Map<string, KbVendor>();
  vendorSlugIndex.clear();
  let dir: string | null = null;
  for (const c of kbDirCandidates()) {
    try { if ((await fs.stat(c)).isDirectory()) { dir = c; break; } } catch { /* keep looking */ }
  }
  if (dir) {
    let names: string[] = [];
    try { names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json") && n !== "schema.json"); } catch { names = []; }
    for (const name of names) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
        if (validateKbFile(raw).length) continue;
        const domain = String(raw.domain).toLowerCase();
        const controls: KbVendor["controls"] = {};
        for (const key of CONTROL_KEYS) {
          const f = cleanFact(raw.controls?.[key]);
          if (f) controls[key] = f;
        }
        const rec: KbVendor = { vendor: sanitizeField(raw.vendor, 120), domain, updatedAt: sanitizeField(raw.updatedAt, 40) || "", controls };
        map.set(domain, rec);
        vendorSlugIndex.set(slug(rec.vendor), domain);
      } catch { /* skip a bad file rather than crash the server */ }
    }
  }
  fileCache = map;
  return map;
}

/** Reset the in-memory file cache (used by tests after writing fixtures). */
export function _resetKbCache() { fileCache = null; vendorSlugIndex.clear(); }

// --- merge -----------------------------------------------------------------

function pick(file?: ControlFact, override?: ControlFact): ControlFact | undefined {
  if (override?.source === "human") return override;   // human-verified always wins
  if (file?.source === "human") return file;
  return override ?? file;                              // else newer override, else file
}

/** Merged facts (file + Store override) for a vendor key, keyed by domain. */
export async function getFacts(key: string): Promise<{ domain: string; vendor: string; controls: Partial<Record<ControlKey, ControlFact>> }> {
  const files = await loadFiles();
  const domain = files.has(key) ? key : (vendorSlugIndex.get(key) || key);
  const file = files.get(domain);
  const override = await store.getKbOverride(domain);
  const controls: Partial<Record<ControlKey, ControlFact>> = {};
  for (const c of CONTROL_KEYS) {
    const f = pick(file?.controls[c], override?.controls[c]);
    if (f) controls[c] = f;
  }
  return { domain, vendor: override?.vendor || file?.vendor || domain, controls };
}

/** Only human-verified facts — the trusted priors injected into the agent. */
export async function getVerifiedFacts(key: string): Promise<Partial<Record<ControlKey, ControlFact>>> {
  const { controls } = await getFacts(key);
  const out: Partial<Record<ControlKey, ControlFact>> = {};
  for (const c of CONTROL_KEYS) if (controls[c]?.source === "human") out[c] = controls[c];
  return out;
}

/** Persist agent findings as unverified proposals so the KB compounds over time.
 *  Never clobbers a human-verified fact. Best-effort: callers ignore failures. */
export async function recordProposals(
  domain: string,
  vendor: string,
  caps: Partial<Record<ControlKey, { verdict: Verdict; standards: string[]; summary: string; citations: { title: string; url: string }[]; confidence?: number }>>,
): Promise<void> {
  const verified = await getVerifiedFacts(domain);
  for (const c of CONTROL_KEYS) {
    const f = caps[c];
    if (!f || f.verdict === "unknown" || verified[c]) continue;
    await store.upsertKbControl(domain, vendor, c, {
      verdict: f.verdict,
      confidence: typeof f.confidence === "number" ? f.confidence : 0.5,
      standards: f.standards || [],
      summary: f.summary || "",
      citations: (f.citations || []).filter((x) => x.url),
      source: "agent",
    });
  }
}
