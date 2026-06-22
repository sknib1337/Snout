// Eval harness (EPIC-MOAT / depth D1): measure verdict quality against a labeled
// benchmark — honestly. Beyond a single accuracy number it reports per-verdict
// precision/recall, a confusion matrix, and confidence calibration, and appends each
// run to a trend history. Default mode is deterministic + KB-only (no LLM) so it can
// gate CI; pass --live to run the real agent. Numbers are measured, not asserted.
//
// HONESTY CAVEAT: the seed KB and the benchmark labels currently draw on the same
// public sources, so covered-vendor accuracy is optimistic. The benchmark's `source`
// field and eval/README.md track the discipline of maintaining labels independently of
// the KB; uncovered vendors and deliberate label/KB mismatches keep the number real.
import fs from "fs";
import path from "path";
import { CONTROLS, ControlKey, Verdict } from "../src/controls";
import { getFacts } from "../src/kb";

const CONTROL_KEYS = CONTROLS.map((c) => c.key) as ControlKey[];
const VERDICTS: Verdict[] = ["supported", "partial", "unsupported", "unknown"];

export interface BenchCase {
  vendor: string;
  domain: string;
  // Provenance of the LABEL (must be independent of the KB's sources — see README).
  source?: string;
  // Whether this vendor has a kb/ file. `false` = held-out generalization probe;
  // its accuracy is the honest "does this work on vendors we haven't curated" number.
  inKb?: boolean;
  expected: Partial<Record<ControlKey, Verdict>>;
}
export type Prediction = { verdict: Verdict; confidence?: number };
export type Predict = (domain: string, vendor: string) => Promise<Partial<Record<ControlKey, Prediction>>>;
export type PerCase = { case: BenchCase; pred: Partial<Record<ControlKey, Prediction>> };

export interface ClassMetric { tp: number; predicted: number; actual: number; precision: number; recall: number; }
export interface CalibBucket { bucket: string; n: number; accuracy: number; avgConfidence: number; }
export interface Metrics {
  total: number; correct: number; accuracy: number; covered: number; coverage: number;
  perControl: Record<string, { correct: number; total: number }>;
  perClass: Record<string, ClassMetric>;
  confusion: Record<string, Record<string, number>>;
  calibration: CalibBucket[];
}

const CALIB_EDGES = [0, 0.5, 0.7, 0.85, 1.0001];

// Gather predictions once per case (the only place that may call the LLM), so the
// same results can be scored over the full set AND any subset (e.g. held-out)
// without re-predicting.
export async function predictAll(cases: BenchCase[], predict: Predict): Promise<PerCase[]> {
  const out: PerCase[] = [];
  for (const cs of cases) out.push({ case: cs, pred: await predict(cs.domain, cs.vendor) });
  return out;
}

// Pure scorer over already-gathered predictions.
export function score(perCases: PerCase[]): Metrics {
  let total = 0, correct = 0, covered = 0;
  const perControl: Metrics["perControl"] = {};
  const perClass: Record<string, ClassMetric> = {};
  const confusion: Record<string, Record<string, number>> = {};
  for (const v of VERDICTS) {
    perClass[v] = { tp: 0, predicted: 0, actual: 0, precision: 0, recall: 0 };
    confusion[v] = Object.fromEntries(VERDICTS.map((p) => [p, 0]));
  }
  const calibPoints: { conf: number; correct: boolean }[] = [];

  for (const { case: cs, pred } of perCases) {
    for (const k of CONTROL_KEYS) {
      const exp = cs.expected[k];
      if (!exp) continue;
      const p = pred[k]?.verdict ?? "unknown";
      const conf = pred[k]?.confidence;
      total++;
      (perControl[k] ??= { correct: 0, total: 0 }).total++;
      if (p !== "unknown") covered++;
      confusion[exp][p]++;
      perClass[p].predicted++;
      perClass[exp].actual++;
      if (p === exp) { correct++; perControl[k].correct++; perClass[p].tp++; }
      if (typeof conf === "number") calibPoints.push({ conf, correct: p === exp });
    }
  }
  for (const v of VERDICTS) {
    const c = perClass[v];
    c.precision = c.predicted ? c.tp / c.predicted : 0;
    c.recall = c.actual ? c.tp / c.actual : 0;
  }
  const calibration: CalibBucket[] = [];
  for (let i = 0; i < CALIB_EDGES.length - 1; i++) {
    const lo = CALIB_EDGES[i], hi = CALIB_EDGES[i + 1];
    const pts = calibPoints.filter((x) => x.conf >= lo && x.conf < hi);
    if (!pts.length) continue;
    calibration.push({
      bucket: `${lo.toFixed(2)}–${(hi > 1 ? 1 : hi).toFixed(2)}`,
      n: pts.length,
      accuracy: pts.filter((x) => x.correct).length / pts.length,
      avgConfidence: pts.reduce((a, x) => a + x.conf, 0) / pts.length,
    });
  }
  return { total, correct, accuracy: total ? correct / total : 0, covered, coverage: total ? covered / total : 0, perControl, perClass, confusion, calibration };
}

// Backward-compatible: predict then score the whole set.
export async function evaluate(cases: BenchCase[], predict: Predict): Promise<Metrics> {
  return score(await predictAll(cases, predict));
}

// Naive floor: predict "unknown" for everything. A model/KB that can't beat this
// adds nothing. Deterministic, no network.
export const naivePredict: Predict = async () => {
  const out: Partial<Record<ControlKey, Prediction>> = {};
  for (const k of CONTROL_KEYS) out[k] = { verdict: "unknown" };
  return out;
};

// Live predictor factory: runs the real agent with the KB on (KB-augmented) or off
// (no-KB baseline). The delta between the two is the KB's measured lift.
export function makeLivePredict(useKb: boolean): Predict {
  return async (domain, vendor) => {
    const { assessApp } = await import("../src/agent");
    const r = await assessApp({ name: vendor, url: `https://${domain}` }, { useKb });
    const out: Partial<Record<ControlKey, Prediction>> = {};
    for (const k of CONTROL_KEYS) out[k] = { verdict: r.capabilities[k]?.verdict ?? "unknown", confidence: r.capabilities[k]?.confidence };
    return out;
  };
}

// KB-only predictor: deterministic, no network. Returns verdict + confidence.
export const kbPredict: Predict = async (domain) => {
  const { controls } = await getFacts(domain);
  const out: Partial<Record<ControlKey, Prediction>> = {};
  for (const k of CONTROL_KEYS) out[k] = { verdict: controls[k]?.verdict ?? "unknown", confidence: controls[k]?.confidence };
  return out;
};

export function loadBenchmark(): BenchCase[] {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, "benchmark.json"), "utf8"));
}

const pct = (n: number) => (n * 100).toFixed(1) + "%";

export interface ComparisonRow { name: string; accAll: number; accHeldOut: number | null; coverage: number; }
export interface ReportExtras { heldOut?: Metrics; heldOutN?: number; comparison?: ComparisonRow[]; lift?: number | null; }

// KB lift = (KB-augmented accuracy) − (no-KB accuracy) over the same cases.
export function kbLift(rows: ComparisonRow[]): number | null {
  const kb = rows.find((r) => /KB-augmented LLM/.test(r.name));
  const noKb = rows.find((r) => /no-KB LLM/.test(r.name));
  return kb && noKb ? kb.accAll - noKb.accAll : null;
}

function report(mode: string, m: Metrics, n: number, stamp: string, trend: any[], extra: ReportExtras = {}): string {
  const controlRows = CONTROL_KEYS.map((k) => {
    const c = m.perControl[k] || { correct: 0, total: 0 };
    return `| ${k} | ${c.correct}/${c.total} | ${pct(c.total ? c.correct / c.total : 0)} |`;
  }).join("\n");
  const classRows = VERDICTS.map((v) => `| ${v} | ${pct(m.perClass[v].precision)} | ${pct(m.perClass[v].recall)} | ${m.perClass[v].actual} |`).join("\n");
  const confHeader = `| expected ↓ \\ predicted → | ${VERDICTS.join(" | ")} |`;
  const confSep = `|${"---|".repeat(VERDICTS.length + 1)}`;
  const confRows = VERDICTS.map((e) => `| ${e} | ${VERDICTS.map((p) => m.confusion[e][p]).join(" | ")} |`).join("\n");
  const calibRows = m.calibration.length
    ? m.calibration.map((b) => `| ${b.bucket} | ${b.n} | ${pct(b.accuracy)} | ${b.avgConfidence.toFixed(2)} |`).join("\n")
    : "| — | 0 | — | — |";
  const trendRows = trend.slice(-8).map((t) => `| ${t.date} | ${t.mode} | ${pct(t.accuracy)} | ${pct(t.coverage)} |`).join("\n");

  const heldOutLine = extra.heldOut
    ? `\n- **Held-out (never-in-KB) accuracy:** ${extra.heldOut.correct}/${extra.heldOut.total} = **${pct(extra.heldOut.accuracy)}** across ${extra.heldOutN ?? "?"} vendors — the generalization number (no KB curation for these).`
    : "";

  const comparisonBlock = extra.comparison?.length
    ? `\n### Baseline comparison
How much does the KB / the model actually add over a naive floor? (Same cases for all rows.)
| Predictor | Accuracy (all) | Accuracy (held-out) | Coverage |
|---|---|---|---|
${extra.comparison.map((r) => `| ${r.name} | ${pct(r.accAll)} | ${r.accHeldOut == null ? "—" : pct(r.accHeldOut)} | ${pct(r.coverage)} |`).join("\n")}
${extra.lift != null ? `\n**KB lift** (KB-augmented − no-KB LLM, all cases): **${extra.lift >= 0 ? "+" : ""}${(extra.lift * 100).toFixed(1)} pts**.` : ""}
`
    : "";

  return `# Eval results

_Generated by \`npm run eval\` (${mode} mode) on ${stamp}. Measured, not asserted — see [server/eval/run.ts](../server/eval/run.ts) and [server/eval/README.md](../server/eval/README.md)._

> **Reading the numbers.** Covered-vendor accuracy can be optimistic when labels and the KB share
> sources, so the bias-resistant signals are: **held-out (never-in-KB) accuracy**, the **baseline
> comparison** (does the KB beat a naive floor / a no-KB model?), the **confusion matrix**, and
> **calibration**. Label-independence discipline is documented in eval/README.md.

- **Cases:** ${n} vendors · ${m.total} control labels
- **Overall accuracy:** ${m.correct}/${m.total} = **${pct(m.accuracy)}**${heldOutLine}
- **KB coverage:** ${m.covered}/${m.total} = ${pct(m.coverage)} (controls with a non-\`unknown\` prediction)
${comparisonBlock}
### Per-control accuracy
| Control | Correct | Accuracy |
|---|---|---|
${controlRows}

### Per-verdict precision / recall
| Verdict | Precision | Recall | Support |
|---|---|---|---|
${classRows}

### Confusion matrix
${confHeader}
${confSep}
${confRows}

### Confidence calibration
Does predicted confidence track actual accuracy? (Well-calibrated ⇒ accuracy ≈ avg confidence per bucket.)
| Confidence bucket | n | Accuracy | Avg confidence |
|---|---|---|---|
${calibRows}

### Recent runs (trend)
| Date | Mode | Accuracy | Coverage |
|---|---|---|---|
${trendRows}
`;
}

async function main() {
  const live = process.argv.includes("--live");
  const baseline = process.argv.includes("--baseline");
  const cases = loadBenchmark();
  const heldOutCases = cases.filter((c) => c.inKb === false);

  // Build the set of predictors to run. Deterministic ones are free; live ones
  // (LLM) only run under --live. The headline is KB-augmented when live, else KB-only.
  const runs: { name: string; predict: Predict; headline?: boolean }[] = [];
  if (baseline) runs.push({ name: "naive (always-unknown)", predict: naivePredict });
  runs.push({ name: "KB-only (deterministic)", predict: kbPredict, headline: !live });
  if (live) {
    if (baseline) runs.push({ name: "no-KB LLM", predict: makeLivePredict(false) });
    runs.push({ name: "KB-augmented LLM", predict: makeLivePredict(true), headline: true });
  }

  // Run each predictor once; score full + held-out from the same predictions.
  const results = [] as { name: string; headline: boolean; all: Metrics; heldOut: Metrics }[];
  for (const r of runs) {
    const per = await predictAll(cases, r.predict);
    results.push({
      name: r.name,
      headline: !!r.headline,
      all: score(per),
      heldOut: score(per.filter((p) => p.case.inKb === false)),
    });
  }

  const head = results.find((r) => r.headline) || results[results.length - 1];
  const mode = live ? (baseline ? "live+baseline" : "live") : (baseline ? "KB-only+baseline" : "KB-only");
  const comparison: ComparisonRow[] | undefined = baseline
    ? results.map((r) => ({ name: r.name, accAll: r.all.accuracy, accHeldOut: heldOutCases.length ? r.heldOut.accuracy : null, coverage: r.all.coverage }))
    : undefined;
  const lift = comparison ? kbLift(comparison) : null;

  const stamp = new Date().toISOString().slice(0, 10);
  const m = head.all;

  // Append to and read back the trend history (one JSON line per run).
  const histFile = path.resolve(__dirname, "..", "..", "kb", "EVAL-history.jsonl");
  const entry: any = { date: stamp, mode, accuracy: m.accuracy, coverage: m.coverage, total: m.total };
  if (heldOutCases.length) entry.heldOutAccuracy = head.heldOut.accuracy;
  if (lift != null) entry.kbLift = lift;
  let trend: any[] = [];
  try { trend = fs.readFileSync(histFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { /* none yet */ }
  trend.push(entry);
  fs.writeFileSync(histFile, trend.map((t) => JSON.stringify(t)).join("\n") + "\n");

  const extras: ReportExtras = {
    heldOut: heldOutCases.length ? head.heldOut : undefined,
    heldOutN: heldOutCases.length || undefined,
    comparison, lift,
  };
  fs.writeFileSync(path.resolve(__dirname, "..", "..", "kb", "EVAL.md"), report(mode, m, cases.length, stamp, trend, extras));
  console.log(`[eval] ${mode}: accuracy ${pct(m.accuracy)} (${m.correct}/${m.total}), coverage ${pct(m.coverage)}${heldOutCases.length ? `, held-out ${pct(head.heldOut.accuracy)}` : ""}${lift != null ? `, KB lift ${(lift * 100).toFixed(1)}pts` : ""} -> kb/EVAL.md`);
}

if (require.main === module) main();
