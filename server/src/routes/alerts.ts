import { Router } from "express";
import { store } from "../store";
import { requireAdmin } from "../security/auth";

// Continuous-monitoring alerts (EPIC-OPERATE) + the audit log (EPIC-ENTERPRISE).
export const alerts = Router();

alerts.get("/alerts", async (_req, res, next) => {
  try { res.json(await store.listAlerts()); } catch (e) { next(e); }
});

alerts.delete("/alerts/:id", async (req, res, next) => {
  try { await store.removeAlert(req.params.id); res.status(204).end(); } catch (e) { next(e); }
});

// Audit log — admin only.
alerts.get("/audit", requireAdmin, async (_req, res, next) => {
  try { res.json(await store.listAudit()); } catch (e) { next(e); }
});
