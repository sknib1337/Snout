import { Router } from "express";
import { z } from "zod";
import { store } from "../store";
import { assessApp } from "../agent";
import { sanitizeField } from "../security/sanitize";
import { assessLimiter, assessSlots } from "../security/limits";

export const catalog = Router();

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/;

const IncomingApp = z.object({
  domain: z.string(),
  name: z.string().optional(),
  methods: z.object({
    sso: z.boolean().optional(), social: z.boolean().optional(), password: z.boolean().optional(),
    federated: z.boolean().optional(), oauthGrant: z.boolean().optional(),
  }).partial().optional(),
  idps: z.array(z.string()).max(10).optional(),
  oauth: z.array(z.object({
    idp: z.string(), clientId: z.string().optional(), scopes: z.array(z.string()).max(40).optional(), ts: z.number().optional(),
  })).max(10).optional(),
  sources: z.array(z.string()).max(8).optional(),
  firstSeen: z.number().optional(),
  lastSeen: z.number().optional(),
});

const IngestBody = z.object({ apps: z.array(IncomingApp).max(500) });

// POST /api/catalog — bulk ingest from the extension / catalog pipeline.
catalog.post("/catalog", async (req, res, next) => {
  const parsed = IngestBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid catalog payload" });
  try {
    let accepted = 0;
    for (const a of parsed.data.apps) {
      const domain = sanitizeField(a.domain, 253).toLowerCase();
      if (!DOMAIN_RE.test(domain)) continue;
      await store.upsertDiscovered({
        domain,
        name: a.name ? sanitizeField(a.name, 80) : undefined,
        methods: a.methods,
        idps: (a.idps || []).map((s) => sanitizeField(s, 253)).filter(Boolean),
        oauth: (a.oauth || []).map((o) => ({
          idp: sanitizeField(o.idp, 253), clientId: sanitizeField(o.clientId, 120),
          scopes: (o.scopes || []).map((s) => sanitizeField(s, 60)).slice(0, 40), ts: o.ts || Date.now(),
        })),
        sources: (a.sources && a.sources.length ? a.sources : ["extension"]).map((s) => sanitizeField(s, 40)),
        firstSeen: a.firstSeen, lastSeen: a.lastSeen,
      });
      accepted++;
    }
    res.status(202).json({ accepted });
  } catch (e) { next(e); }
});

// GET /api/catalog — list discovered apps, enriched with any linked assessment.
catalog.get("/catalog", async (_req, res, next) => {
  try {
    const apps = await store.listDiscovered();
    const out = await Promise.all(apps.map(async (a) => {
      if (!a.assessmentId) return a;
      const assessment = await store.get(a.assessmentId);
      return assessment ? { ...a, assessment: { id: assessment.id, score: assessment.score, recommendation: assessment.recommendation } } : a;
    }));
    res.json(out);
  } catch (e) { next(e); }
});

catalog.delete("/catalog/:domain", async (req, res, next) => {
  try { await store.removeDiscovered(req.params.domain.toLowerCase()); res.status(204).end(); } catch (e) { next(e); }
});

// POST /api/catalog/:domain/assess — assess a discovered app and link the result.
catalog.post("/catalog/:domain/assess", assessLimiter, async (req, res) => {
  const domain = sanitizeField(req.params.domain, 253).toLowerCase();
  if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: "Invalid domain" });
  if (!assessSlots.tryAcquire()) return res.status(429).json({ error: "Server is busy — try again shortly." });
  try {
    const disc = await store.getDiscovered(domain);
    const methods = disc ? Object.entries(disc.methods).filter(([, v]) => v).map(([k]) => k).join(", ") : "";
    const record = await assessApp({
      name: disc?.name || domain,
      url: "https://" + domain,
      context: `Discovered app (${disc?.sources?.join("/") || "catalog"}). Observed auth: ${methods || "unknown"}.`,
    });
    await store.upsertByApp(record);
    await store.linkAssessment(domain, record.id);
    console.log(`[audit] ${(req as any).id} assess(discovered) "${domain}" -> ${record.recommendation} (${record.score})`);
    res.json(record);
  } catch (e: any) {
    res.status(502).json({ error: e.message || "Assessment failed" });
  } finally {
    assessSlots.release();
  }
});
