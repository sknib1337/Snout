import { Router } from "express";
import { z } from "zod";
import { assessApp } from "../agent";
import { store } from "../store";

export const assessments = Router();

const AssessBody = z.object({
  name: z.string().min(1).max(120),
  vendor: z.string().max(120).optional(),
  url: z.string().url().max(300).optional().or(z.literal("")),
  context: z.string().max(600).optional(),
});

assessments.get("/assessments", async (_req, res) => {
  res.json(await store.list());
});

assessments.get("/assessments/:id", async (req, res) => {
  const a = await store.get(req.params.id);
  if (!a) return res.status(404).json({ error: "Not found" });
  res.json(a);
});

assessments.delete("/assessments/:id", async (req, res) => {
  await store.remove(req.params.id);
  res.status(204).end();
});

// Long-running (~20–40s): runs the agent, then persists and returns the record.
assessments.post("/assess", async (req, res) => {
  const parsed = AssessBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", detail: parsed.error.issues });
  try {
    const record = await assessApp({ ...parsed.data, url: parsed.data.url || undefined });
    await store.upsertByApp(record);
    res.json(record);
  } catch (e: any) {
    res.status(502).json({ error: e.message || "Assessment failed" });
  }
});
