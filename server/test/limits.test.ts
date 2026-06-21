import { describe, it, expect } from "vitest";
import { clientKey } from "../src/security/limits";

// Minimal Express Request stub: clientKey only reads .header("authorization") and .ip.
const mk = (ip?: string, auth?: string) => ({ header: () => auth, ip } as any);

describe("clientKey (rate-limit key)", () => {
  it("prefers a hashed bearer token over the IP", () => {
    const k = clientKey(mk("1.2.3.4", "Bearer secret"));
    expect(k).toMatch(/^t:/);
    expect(k).not.toContain("secret"); // token is hashed, not embedded
  });

  it("keys IPv4 by address", () => {
    expect(clientKey(mk("203.0.113.7"))).toBe("ip:203.0.113.7");
  });

  it("normalizes IPv6 to a subnet so a client can't rotate within a /64 to bypass limits", () => {
    const a = clientKey(mk("2001:db8:1:2:3:4:5:6"));
    const b = clientKey(mk("2001:db8:1:2:3:4:5:7"));
    expect(a).toBe(b); // same subnet -> same key
    expect(a).not.toBe("ip:2001:db8:1:2:3:4:5:6"); // not the raw per-address key
  });
});
