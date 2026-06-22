import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { randomUUID } from "crypto";
import { config } from "../config";
import { store } from "../store";
import { runAsTenant } from "../tenant";
import { sanitizeField } from "./sanitize";
import { readCookie, readSession, SESSION_COOKIE } from "../oidc";

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
export async function apiAuth(req: Request, res: Response, next: NextFunction) {
  (req as any).tenant = sanitizeField(req.header("x-tenant"), 64) || config.tenantId;

  // 1) Bearer token (admin / read-only viewer). Trusted API/operator clients.
  const provided = req.header("authorization") || "";
  if (config.apiToken) {
    if (timingSafe(provided, `Bearer ${config.apiToken}`)) { (req as any).role = "admin" as Role; return next(); }
    if (config.viewerToken && timingSafe(provided, `Bearer ${config.viewerToken}`)) { (req as any).role = "viewer" as Role; return next(); }
  }

  // 2) OIDC session cookie. Role and tenant come from the verified session — the
  // session tenant is authoritative (a logged-in user cannot escape it via x-tenant).
  if (config.oidcEnabled) {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      const session = await readSession(token);
      if (session) {
        (req as any).role = session.role;
        (req as any).tenant = session.tenant || (req as any).tenant;
        (req as any).user = session.sub;
        return next();
      }
    }
  }

  // 3) Dev convenience: no auth configured at all (assertStartup blocks this in
  // production unless ALLOW_ANON). Full access.
  if (!config.apiToken && !config.oidcEnabled) { (req as any).role = "admin" as Role; return next(); }

  // 4) Reject.
  return res.status(401).json({ error: "Unauthorized" });
}

/**
 * Run the rest of the request inside the resolved tenant's async context so the
 * store facade scopes every read/write to that tenant (Postgres backend). Must be
 * mounted AFTER apiAuth, which resolves req.tenant. In the JSON (single-tenant)
 * backend this is a no-op beyond setting the context.
 */
export function withTenant(req: Request, _res: Response, next: NextFunction) {
  runAsTenant((req as any).tenant || config.tenantId, () => next());
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
