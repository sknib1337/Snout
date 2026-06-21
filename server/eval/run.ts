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

export interface BenchCase { vendor: string; domain: string; source?: string; expected: Partial<Record<ControlKey, Verdict>>; }
export type Prediction = { verdict: Verdict; confidence?: number };
export type Predict = (domain: string, vendor: string) => Promise<Partial<Record<ControlKey, Prediction>>>;

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

export async function evaluate(cases: BenchCase[], predict: Predict): Promise<Metrics> {
  let total = 0, correct = 0, covered = 0;
  const perControl: Metrics["perControl"] = {};
  const perClass: Record<string, ClassMetric> = {};
  const confusion: Record<string, Record<string, number>> = {};
  for (const v of VERDICTS) {
    perClass[v] = { tp: 0, predicted: 0, actual: 0, precision: 0, recall: 0 };
    confusion[v] = Object.fromEntries(VERDICTS.map((p) => [p, 0]));
  }
  const calibPoints: { conf: number; correct: boolean }[] = [];

  for (const cs of cases) {
    const pred = await predict(cs.domain, cs.vendor);
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

function report(mode: string, m: Metrics, n: number, stamp: string, trend: any[]): string {
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

  return `# Eval results

_Generated by \`npm run eval\` (${mode} mode) on ${stamp}. Measured, not asserted — see [server/eval/run.ts](../server/eval/run.ts) and [server/eval/README.md](../server/eval/README.md)._

> **Honesty caveat.** The seed KB and these benchmark labels currently draw on the same public
> sources, so covered-vendor accuracy is optimistic. Treat **coverage**, the **confusion matrix**,
> **calibration**, and **uncovered vendors** as the real signal. Maintaining labels independently
> of the KB (see eval/README.md) is the open work to remove this bias.

- **Cases:** ${n} vendors · ${m.total} control labels
- **Overall accuracy:** ${m.correct}/${m.total} = **${pct(m.accuracy)}**
- **KB coverage:** ${m.covered}/${m.total} = ${pct(m.coverage)} (controls with a non-\`unknown\` prediction)

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
  const cases = loadBenchmark();
  let predict = kbPredict;
  let mode = "KB-only";
  if (live) {
    mode = "live";
    const { assessApp } = await import("../src/agent");
    predict = async (domain, vendor) => {
      const r = await assessApp({ name: vendor, url: `https://${domain}` });
      const out: Partial<Record<ControlKey, Prediction>> = {};
      for (const k of CONTROL_KEYS) out[k] = { verdict: r.capabilities[k]?.verdict ?? "unknown", confidence: r.capabilities[k]?.confidence };
      return out;
    };
  }
  const m = await evaluate(cases, predict);
  const stamp = new Date().toISOString().slice(0, 10);

  // Append to and read back the trend history (one JSON line per run).
  const histFile = path.resolve(__dirname, "..", "..", "kb", "EVAL-history.jsonl");
  const entry = { date: stamp, mode, accuracy: m.accuracy, coverage: m.coverage, total: m.total };
  let trend: any[] = [];
  try { trend = fs.readFileSync(histFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { /* none yet */ }
  trend.push(entry);
  fs.writeFileSync(histFile, trend.map((t) => JSON.stringify(t)).join("\n") + "\n");

  fs.writeFileSync(path.resolve(__dirname, "..", "..", "kb", "EVAL.md"), report(mode, m, cases.length, stamp, trend));
  console.log(`[eval] ${mode}: accuracy ${pct(m.accuracy)} (${m.correct}/${m.total}), coverage ${pct(m.coverage)} -> kb/EVAL.md`);
}

if (require.main === module) main();
