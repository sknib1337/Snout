import { describe, it, expect } from "vitest";
import { computeScore, readiness } from "../src/controls";

const finding = (verdict: any) => ({ verdict, standards: [], summary: "", citations: [] });

describe("computeScore", () => {
  it("is 100 when every control is supported", () => {
    const caps = Object.fromEntries(
      ["sso", "ulm", "entitlements", "riskSignals", "logout", "tokenRevocation"].map((k) => [k, finding("supported")]),
    );
    expect(computeScore(caps as any)).toBe(100);
  });

  it("treats missing controls as unknown (weight 25)", () => {
    expect(computeScore({} as any)).toBe(25);
  });

  it("maps score bands to readiness labels", () => {
    expect(readiness(85)).toBe("Controls Ready");
    expect(readiness(60)).toBe("Partial");
    expect(readiness(20)).toBe("Not Ready");
  });
});
