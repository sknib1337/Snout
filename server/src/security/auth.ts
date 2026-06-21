import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { randomUUID } from "crypto";
import { config } from "../config";
import { store } from "../store";
import { sanitizeField } from "./sanitize";

export type Role = "admin" | "viewer";

function timingSafe(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Browser-facing API auth + role resolution (EPIC-ENTERPRISE RBAC). Fails closed:
 * if a token is configured it is required; in production a token is mandatory
 * (enforced at startup) unless ALLOW_ANON. The admin API_TOKEN can do everything;
 * an optional API_VIEWER_TOKEN is read-only. Also tags the request with a tenant.
 */
export function apiAuth(req: Request, res: Response, next: NextFunction) {
  (req as any).tenant = sanitizeField(req.header("x-tenant"), 64) || config.tenantId;
  if (!config.apiToken) {
    // Dev convenience only (assertStartup blocks anon in production). Full access.
    (req as any).role = "admin" as Role;
    return next();
  }
  const provided = req.header("authorization") || "";
  if (timingSafe(provided, `Bearer ${config.apiToken}`)) { (req as any).role = "admin" as Role; return next(); }
  if (config.viewerToken && timingSafe(provided, `Bearer ${config.viewerToken}`)) { (req as any).role = "viewer" as Role; return next(); }
  return res.status(401).json({ error: "Unauthorized" });
}

/** Block mutating methods for the read-only viewer role. */
export function writeGuard(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  if ((req as any).role === "viewer") return res.status(403).json({ error: "Read-only role: this token cannot modify data" });
  return next();
}

/** Gate a route to the admin role (e.g. the audit log). */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if ((req as any).role === "admin") return next();
  return res.status(403).json({ error: "Admin role required" });
}

/** Record every mutating API call to the audit log (who/what/outcome). */
export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  res.on("finish", () => {
    store.addAudit({
      id: randomUUID(), ts: Date.now(), requestId: (req as any).id,
      role: (req as any).role || "admin", tenant: (req as any).tenant || config.tenantId,
      method: req.method, path: req.path, status: res.statusCode,
    }).catch(() => { /* never fail a request over audit */ });
  });
  next();
}
