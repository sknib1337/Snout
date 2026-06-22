import { describe, it, expect } from "vitest";
import { naivePredict, predictAll, score, kbLift, type BenchCase, type PerCase, type ComparisonRow } from "../eval/run";

describe("naivePredict", () => {
  it("predicts unknown for every control (the floor)", async () => {
    const p = await naivePredict("anything.com", "Anything");
    expect(Object.values(p).every((x) => x?.verdict === "unknown")).toBe(true);
    expect(Object.keys(p).length).toBe(6);
  });
});

describe("predictAll + score", () => {
  const cases: BenchCase[] = [
    { vendor: "A", domain: "a.com", inKb: true, expected: { sso: "supported", ulm: "partial" } },
    { vendor: "B", domain: "b.com", inKb: false, expected: { sso: "supported", ulm: "supported" } },
  ];
  const preds: PerCase[] = [
    { case: cases[0], pred: { sso: { verdict: "supported" }, ulm: { verdict: "partial" } } },       // 2/2
    { case: cases[1], pred: { sso: { verdict: "supported" }, ulm: { verdict: "unknown" } } },        // 1/2
  ];

  it("scores correct/total over the full set", () => {
    const m = score(preds);
    expect(m.total).toBe(4);
    expect(m.correct).toBe(3);
    expect(m.accuracy).toBeCloseTo(0.75);
  });

  it("scores a held-out subset (inKb === false) independently", () => {
    const heldOut = score(preds.filter((p) => p.case.inKb === false));
    expect(heldOut.total).toBe(2);
    expect(heldOut.correct).toBe(1); // only sso matches; ulm supported vs unknown
    expect(heldOut.accuracy).toBeCloseTo(0.5);
  });

  it("predictAll runs the predictor once per case", async () => {
    const per = await predictAll(cases, naivePredict);
    expect(per.length).toBe(2);
    expect(per[0].pred.sso?.verdict).toBe("unknown");
    expect(per[0].case.vendor).toBe("A");
  });

  it("confusion totals reconcile with the label count", () => {
    const m = score(preds);
    const confTotal = Object.values(m.confusion).reduce(
      (a, row) => a + Object.values(row).reduce((x, y) => x + y, 0), 0);
    expect(confTotal).toBe(m.total);
  });
});

describe("kbLift", () => {
  it("computes KB-augmented minus no-KB accuracy", () => {
    const rows: ComparisonRow[] = [
      { name: "naive (always-unknown)", accAll: 0.3, accHeldOut: 0.4, coverage: 0 },
      { name: "no-KB LLM", accAll: 0.6, accHeldOut: 0.5, coverage: 1 },
      { name: "KB-augmented LLM", accAll: 0.7, accHeldOut: 0.55, coverage: 1 },
    ];
    expect(kbLift(rows)).toBeCloseTo(0.1);
  });

  it("returns null when the live pair is absent (e.g. deterministic-only run)", () => {
    const rows: ComparisonRow[] = [
      { name: "naive (always-unknown)", accAll: 0.3, accHeldOut: 0.4, coverage: 0 },
      { name: "KB-only (deterministic)", accAll: 0.8, accHeldOut: 0.47, coverage: 0.52 },
    ];
    expect(kbLift(rows)).toBeNull();
  });
});
