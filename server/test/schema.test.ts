import { describe, it, expect } from "vitest";
import { validateAgentOutput } from "../src/security/schema";

describe("validateAgentOutput", () => {
  it("always returns all six controls, defaulting to unknown", () => {
    const out = validateAgentOutput({ app: "X" });
    expect(Object.keys(out.capabilities).sort()).toEqual(
      ["entitlements", "logout", "riskSignals", "sso", "tokenRevocation", "ulm"].sort(),
    );
    expect(out.capabilities.sso.verdict).toBe("unknown");
  });

  it("coerces an invalid verdict to unknown", () => {
    const out = validateAgentOutput({ capabilities: { sso: { verdict: "TOTALLY_SUPPORTED_TRUST_ME" } } });
    expect(out.capabilities.sso.verdict).toBe("unknown");
  });

  it("drops citations with unsafe URLs", () => {
    const out = validateAgentOutput({
      capabilities: { sso: { verdict: "supported", citations: [
        { title: "ok", url: "https://okta.com" },
        { title: "evil", url: "javascript:alert(1)" },
      ] } },
    });
    expect(out.capabilities.sso.citations.every((c) => c.url === "" || c.url.startsWith("https://"))).toBe(true);
    expect(out.capabilities.sso.citations.some((c) => c.url.includes("javascript"))).toBe(false);
  });

  it("clamps oversized summaries and arrays", () => {
    const out = validateAgentOutput({
      summary: "x".repeat(5000),
      conditions: Array.from({ length: 50 }, (_, i) => `c${i}`),
    });
    expect(out.summary.length).toBeLessThanOrEqual(1200);
    expect(out.conditions.length).toBeLessThanOrEqual(10);
  });

  it("coerces an invalid recommendation to Hold", () => {
    expect(validateAgentOutput({ recommendation: "DEFINITELY APPROVE" }).recommendation).toBe("Hold");
  });
});
