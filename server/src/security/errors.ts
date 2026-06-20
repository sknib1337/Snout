import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = req.header("x-request-id") || crypto.randomUUID();
  (req as any).id = id;
  res.setHeader("x-request-id", id);
  next();
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}

// Never leak stack traces or internal details to clients.
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const id = (req as any).id;
  console.error(`[error] ${id} ${req.method} ${req.path}:`, err?.message || err);
  if (res.headersSent) return;
  res.status(err?.status || 500).json({ error: "Internal error", requestId: id });
}
