import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { Request } from "express";
import crypto from "crypto";
import { config } from "../config";

// Key by bearer token (hashed) when present, else client IP. Requires
// app.set("trust proxy", ...) so the IP is the real client behind a proxy.
// IPv6 is normalized to a subnet via express-rate-limit's ipKeyGenerator so a
// client can't rotate addresses within a /64 to evade limits (and to satisfy the
// ERR_ERL_KEY_GEN_IPV6 validation in express-rate-limit v8).
export function clientKey(req: Request): string {
  const auth = req.header("authorization");
  if (auth) return "t:" + crypto.createHash("sha256").update(auth).digest("hex").slice(0, 16);
  return "ip:" + ipKeyGenerator(req.ip || "unknown");
}

// General API throttle.
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: "Too many requests" },
});

// Stricter limit on the expensive, LLM-backed business flow (API6 anti-automation).
export const assessLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.assessRateMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: "Assessment rate limit reached — try again shortly." },
});

// Webhook endpoints get their own bucket.
export const webhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: "Too many requests" },
});

/** Bound concurrent in-flight assessments to cap cost/DoS (Unbounded Consumption). */
class Semaphore {
  private current = 0;
  constructor(private readonly max: number) {}
  tryAcquire(): boolean { if (this.current >= this.max) return false; this.current++; return true; }
  release(): void { this.current = Math.max(0, this.current - 1); }
  get inFlight() { return this.current; }
}
export const assessSlots = new Semaphore(config.maxConcurrentAssessments);
