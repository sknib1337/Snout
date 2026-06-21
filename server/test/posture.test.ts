import { describe, it, expect } from "vitest";
import { posture, topSeverity } from "../src/posture";

const base = { domain: "x.com", name: "X", idps: [], oauth: [], sources: [], firstSeen: 0, lastSeen: 0 };

describe("posture findings", () => {
  it("flags shadow auth: no SSO + local password are high severity", () => {
    const { findings, riskScore } = posture({ ...base, methods: { sso: false, social: false, password: true, federated: false, oauthGrant: false } });
    const ids = findings.map((f) => f.id);
    expect(ids).toContain("no-sso");
    expect(ids).toContain("local-password");
    expect(topSeverity(findings)).toBe("high");
    expect(riskScore).toBeGreaterThanOrEqual(80);
  });

  it("a corporate-SSO app with no risky grants is clean", () => {
    const { findings, riskScore } = posture({ ...base, methods: { sso: true, social: false, password: false, federated: true, oauthGrant: false } });
    expect(findings).toHaveLength(0);
    expect(riskScore).toBe(0);
  });

  it("detects broad OAuth scopes and offline tokens", () => {
    const { findings } = posture({
      ...base,
      methods: { sso: true, social: false, password: false, federated: false, oauthGrant: true },
      oauth: [{ idp: "google", clientId: "c", scopes: ["openid", "https://www.googleapis.com/auth/drive", "offline_access"], ts: 1 }],
    });
    const ids = findings.map((f) => f.id);
    expect(ids).toContain("risky-oauth-scope");
    expect(ids).toContain("offline-token");
  });

  it("flags consumer IdP as medium", () => {
    const { findings } = posture({ ...base, methods: { sso: true, social: true, password: false, federated: false, oauthGrant: false } });
    expect(findings.map((f) => f.id)).toContain("consumer-idp");
  });
});
