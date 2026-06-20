import { describe, it, expect } from "vitest";
import { hmacHex, safeEqual } from "../src/lib/hmac";

describe("hmac", () => {
  it("verifies a matching signature", () => {
    const body = Buffer.from(JSON.stringify({ records: [{ u_app_name: "Asana" }] }));
    const sig = hmacHex("topsecret", body);
    expect(safeEqual(sig, hmacHex("topsecret", body))).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = hmacHex("topsecret", Buffer.from("a"));
    expect(safeEqual(sig, hmacHex("topsecret", Buffer.from("b")))).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const body = Buffer.from("payload");
    expect(safeEqual(hmacHex("k1", body), hmacHex("k2", body))).toBe(false);
  });
});
