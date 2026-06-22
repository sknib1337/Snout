import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let kb: typeof import("../src/kb");
let store: typeof import("../src/store").store;
let evalmod: typeof import("../eval/run");

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ta-kb-"));
  kb = await import("../src/kb");
  store = (await import("../src/store")).store;
  evalmod = await import("../eval/run");
  kb._resetKbCache();
});

describe("KB file validation", () => {
  it("accepts a well-formed file and rejects a malformed one", () => {
    expect(kb.validateKbFile({ vendor: "X", domain: "x.com", controls: { sso: { verdict: "supported", source: "seed" } } })).toEqual([]);
    const errs = kb.validateKbFile({ domain: "x.com", controls: { sso: { verdict: "yes" }, bogus: { verdict: "supported" } } });
    expect(errs.length).toBeGreaterThan(0);
  });
});

describe("KB load + merge", () => {
  it("loads seeded vendor facts", async () => {
    const f = await kb.getFacts("slack.com");
    expect(f.vendor).toBe("Slack");
    expect(f.controls.sso?.verdict).toBe("supported");
    expect(f.controls.sso?.source).toBe("human");
  });

  it("resolves a vendor name to its domain key", async () => {
    await kb.getFacts("github.com"); // ensure files loaded
    expect(kb.kbKeyFor({ vendor: "GitHub" })).toBe("github.com");
    expect(kb.kbKeyFor({ url: "https://www.notion.so/some/page" })).toBe("notion.so");
  });

  it("getVerifiedFacts returns only human-verified controls", async () => {
    const v = await kb.getVerifiedFacts("slack.com");
    expect(v.sso?.verdict).toBe("supported");   // human
    expect(v.ulm?.verdict).toBe("supported");   // human
    expect(v.entitlements).toBeUndefined();     // seed, not verified
  });

  it("listAllVendors merges repo files + overrides and sorts by vendor", async () => {
    const all = await kb.listAllVendors();
    const names = all.map((v) => v.vendor);
    expect(names).toContain("Slack");
    expect(names).toContain("GitHub");
    expect([...names]).toEqual([...names].sort((a, b) => a.localeCompare(b))); // sorted
  });
});

describe("eval harness (KB-only, deterministic)", () => {
  it("measures accuracy + depth metrics against the labeled benchmark", async () => {
    const cases = evalmod.loadBenchmark();
    const m = await evalmod.evaluate(cases, evalmod.kbPredict);
    // Robust to benchmark growth: total = sum of labeled controls across all cases.
    const expectedTotal = cases.reduce((n, c) => n + Object.keys(c.expected).length, 0);
    expect(m.total).toBe(expectedTotal);
    // CI gate: accuracy must not regress below this floor.
    expect(m.accuracy).toBeGreaterThanOrEqual(0.6); // covered vendors match; uncovered + drift reveal gaps
    expect(m.coverage).toBeGreaterThan(0);
    // depth metrics are present and well-formed
    expect(m.perClass.supported.precision).toBeGreaterThan(0);
    expect(m.perClass.supported.recall).toBeGreaterThan(0);
    expect(m.confusion.supported.supported).toBeGreaterThan(0);
    expect(m.calibration.length).toBeGreaterThan(0);
    // confusion matrix totals reconcile with the label count
    const confTotal = Object.values(m.confusion).reduce((a, row: any) => a + Object.values(row).reduce((x: number, y) => x + (y as number), 0), 0);
    expect(confTotal).toBe(m.total);
  });
});

describe("kbStats (coverage + verification health)", () => {
  it("counts facts by source and computes the verified ratio", async () => {
    const s = await kb.kbStats();
    expect(s.vendors).toBeGreaterThanOrEqual(11);
    expect(s.facts).toBe(s.bySource.human + s.bySource.agent + s.bySource.seed);
    expect(s.bySource.human).toBeGreaterThanOrEqual(8); // seeded human-verified facts
    expect(s.verifiedRatio).toBeCloseTo(s.bySource.human / s.facts);
    expect(s.controlCoverage.sso).toBeGreaterThanOrEqual(11);
  });

  it("flags human facts as stale once past the freshness window", async () => {
    const future = Date.parse("2099-01-01T00:00:00Z");
    const s = await kb.kbStats(future);
    expect(s.staleVerified).toBeGreaterThan(0);
    expect(s.staleVerified).toBeLessThanOrEqual(s.bySource.human);
  });
});

describe("kbVerifiedPredict (human-only) vs kbPredict (all facts)", () => {
  it("returns only human-verified verdicts, unknown for seed-only controls", async () => {
    const p = await evalmod.kbVerifiedPredict("slack.com", "Slack");
    expect(p.sso?.verdict).toBe("supported");      // human-verified
    expect(p.entitlements?.verdict).toBe("unknown"); // seed only -> not surfaced
  });
});

describe("KB override precedence", () => {
  it("human override beats a seed file fact; an agent proposal never beats a human file fact", async () => {
    // human override of a seed control
    await store.upsertKbControl("slack.com", "Slack", "entitlements", {
      verdict: "supported", confidence: 1, standards: ["SCIM groups"], summary: "verified", citations: [], source: "human", verifiedBy: "tester", verifiedAt: "2026-06-21",
    });
    const v = await kb.getVerifiedFacts("slack.com");
    expect(v.entitlements?.verdict).toBe("supported");

    // an agent proposal must NOT override the human-verified file fact for sso
    await store.upsertKbControl("slack.com", "Slack", "sso", {
      verdict: "unknown", confidence: 0.4, standards: [], summary: "guess", citations: [], source: "agent",
    });
    const f = await kb.getFacts("slack.com");
    expect(f.controls.sso?.verdict).toBe("supported");
    expect(f.controls.sso?.source).toBe("human");
  });
});
