import { Router } from "express";
import { z } from "zod";
import { assessApp } from "../agent";
import { store } from "../store";
import { assessLimiter, assessSlots } from "../security/limits";
import { config } from "../config";

export const assessments = Router();

// Lets the web app discover which capabilities are enabled (e.g. show/hide the
// Discovered view). No secrets — safe behind the normal API auth.
assessments.get("/config", (_req, res) => {
  res.json({
    features: { catalog: config.enableCatalog },
    model: config.llmProvider === "anthropic" ? config.anthropicModel : config.llmModel,
  });
});

const AssessBody = z.object({
  name: z.string().min(1).max(120),
  vendor: z.string().max(120).optional(),
  url: z.string().max(2048).optional().or(z.literal("")),
  context: z.string().max(600).optional(),
});

assessments.get("/assessments", async (_req, res, next) => {
  try { res.json(await store.list()); } catch (e) { next(e); }
});

assessments.get("/assessments/:id", async (req, res, next) => {
  try {
    const a = await store.get(req.params.id);
    if (!a) return res.status(404).json({ error: "Not found" });
    res.json(a);
  } catch (e) { next(e); }
});

assessments.delete("/assessments/:id", async (req, res, next) => {
  try { await store.remove(req.params.id); res.status(204).end(); } catch (e) { next(e); }
});

// Expensive LLM-backed business flow: stricter rate limit + concurrency cap.
assessments.post("/assess", assessLimiter, async (req, res) => {
  const parsed = AssessBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });

  if (!assessSlots.tryAcquire()) {
    return res.status(429).json({ error: "Server is busy assessing other apps — try again shortly." });
  }
  try {
    const record = await assessApp({ ...parsed.data, url: parsed.data.url || undefined });
    await store.upsertByApp(record);
    console.log(`[audit] ${(req as any).id} assess "${record.app}" -> ${record.recommendation} (${record.score})`);
    res.json(record);
  } catch (e: any) {
    res.status(502).json({ error: e.message || "Assessment failed" });
  } finally {
    assessSlots.release();
  }
});
