import { describe, it, expect } from "vitest";
import { applyRefutations, parseRefutations, buildRefutationPrompt } from "../src/verify";

const f = (verdict: any, source?: any, confidence?: number) => ({ verdict, standards: ["SAML"], summary: "x", citations: [{ title: "t", url: "https://e.com" }], confidence, source });

describe("parseRefutations", () => {
  it("parses JSON and defaults refuted=true when omitted/uncertain", () => {
    const r = parseRefutations('{"refutations":[{"control":"sso","refuted":false},{"control":"ulm"}]}');
    expect(r.find((x) => x.control === "sso")?.refuted).toBe(false);
    expect(r.find((x) => x.control === "ulm")?.refuted).toBe(true);
  });
  it("returns [] on junk", () => {
    expect(parseRefutations("not json")).toEqual([]);
  });
});

describe("applyRefutations", () => {
  it("demotes a refuted positive verdict to unknown and caps the recommendation", () => {
    const caps: any = { sso: f("supported", "agent", 0.9), ulm: f("supported", "agent", 0.8) };
    const out = applyRefutations(caps, "Approve", [{ control: "sso", refuted: true }]);
    expect(out.caps.sso.verdict).toBe("unknown");
    expect(out.caps.sso.citations).toEqual([]);
    expect(out.caps.sso.confidence).toBeLessThanOrEqual(0.3);
    expect(out.caps.ulm.verdict).toBe("supported"); // not refuted
    expect(out.recommendation).toBe("Hold");
    expect(out.demoted).toEqual(["sso"]);
  });

  it("never demotes a human-verified KB fact", () => {
    const caps: any = { sso: f("supported", "kb-verified", 1) };
    const out = applyRefutations(caps, "Approve", [{ control: "sso", refuted: true }]);
    expect(out.caps.sso.verdict).toBe("supported");
    expect(out.recommendation).toBe("Approve");
    expect(out.demoted).toEqual([]);
  });
});

describe("buildRefutationPrompt", () => {
  it("only lists non-unknown, non-KB-verified controls", () => {
    const caps: any = { sso: f("supported", "agent"), ulm: f("unknown", "agent"), entitlements: f("partial", "kb-verified") };
    const p = buildRefutationPrompt("Acme", caps);
    expect(p).toContain("sso:");
    expect(p).not.toContain("ulm:");
    expect(p).not.toContain("entitlements:");
  });
});
