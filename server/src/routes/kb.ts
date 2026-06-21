import { Router } from "express";
import { z } from "zod";
import { store } from "../store";
import { getFacts } from "../kb";
import { CONTROLS, ControlKey, ControlFact } from "../controls";
import { sanitizeField, safeUrl } from "../security/sanitize";

export const kb = Router();

const CONTROL_KEYS = CONTROLS.map((c) => c.key) as ControlKey[];

// GET /api/kb/:key — merged (repo file + override) facts for a vendor.
kb.get("/kb/:key", async (req, res, next) => {
  try {
    const key = sanitizeField(req.params.key, 253).toLowerCase();
    res.json(await getFacts(key));
  } catch (e) { next(e); }
});

const VerifyBody = z.object({
  verdict: z.enum(["supported", "partial", "unsupported", "unknown"]),
  confidence: z.number().min(0).max(1).optional(),
  standards: z.array(z.string()).max(8).optional(),
  summary: z.string().optional(),
  citations: z.array(z.object({ title: z.string().optional(), url: z.string().optional() })).max(3).optional(),
  vendor: z.string().optional(),
  verifiedBy: z.string().optional(),
});

// POST /api/kb/:key/:control — human verify/override one control (source "human").
kb.post("/kb/:key/:control", async (req, res, next) => {
  const key = sanitizeField(req.params.key, 253).toLowerCase();
  const control = req.params.control as ControlKey;
  if (!CONTROL_KEYS.includes(control)) return res.status(400).json({ error: "Unknown control" });
  const parsed = VerifyBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid verify payload" });
  try {
    const b = parsed.data;
    const fact: ControlFact = {
      verdict: b.verdict,
      confidence: typeof b.confidence === "number" ? b.confidence : 1,
      standards: (b.standards || []).map((s) => sanitizeField(s, 40)).filter(Boolean).slice(0, 8),
      summary: sanitizeField(b.summary, 600),
      citations: (b.citations || [])
        .map((c) => ({ title: sanitizeField(c.title, 160), url: safeUrl(c.url) || "" }))
        .filter((c) => c.url || c.title)
        .slice(0, 3),
      source: "human",
      verifiedBy: sanitizeField(b.verifiedBy, 80) || "dashboard",
      verifiedAt: new Date().toISOString(),
    };
    const updated = await store.upsertKbControl(key, sanitizeField(b.vendor, 120) || key, control, fact);
    console.log(`[audit] ${(req as any).id} kb-verify "${key}" ${control} -> ${fact.verdict} by ${fact.verifiedBy}`);
    res.json(updated);
  } catch (e) { next(e); }
});
