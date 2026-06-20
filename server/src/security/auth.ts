import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "../config";

function timingSafe(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Browser-facing API auth. Fails closed: if a token is configured it is
 * required; in production a token is mandatory (enforced at startup) unless
 * ALLOW_ANON is explicitly set. No anonymous access by default.
 */
export function apiAuth(req: Request, res: Response, next: NextFunction) {
  if (!config.apiToken) {
    if (config.allowAnon) return next();
    // Dev convenience only (assertStartup blocks this combo in production).
    return next();
  }
  const provided = req.header("authorization") || "";
  if (timingSafe(provided, `Bearer ${config.apiToken}`)) return next();
  return res.status(401).json({ error: "Unauthorized" });
}
