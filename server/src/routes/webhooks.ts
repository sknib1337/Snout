import { Router } from "express";
import { config } from "../config";
import { hmacHex, safeEqual } from "../lib/hmac";
import { assessApp, AssessInput } from "../agent";
import { store } from "../store";

export const webhooks = Router();

// Map each system of record's catalog shape onto a normalized assessment input.
const normalize: Record<string, (r: any) => AssessInput> = {
  servicenow: (r) => ({ name: r.u_app_name, vendor: r.u_vendor, context: `Catalog: ${r.u_category || ""} (ServiceNow ${r.sys_id || ""})` }),
  okta:       (r) => ({ name: r.label, vendor: r.vendor || "", context: `Catalog: ${r.signOnMode || ""} (Okta ${r.id || ""})` }),
  netsuite:   (r) => ({ name: r.itemid, vendor: r.vendorname, context: `Catalog: ${r.class || ""} (NetSuite ${r.internalid || ""})` }),
};

// Assess in the background so the catalog source gets a fast 202.
async function queue(input: AssessInput) {
  try {
    const record = await assessApp(input);
    await store.upsertByApp(record);
  } catch (e: any) {
    console.error(`[catalog] assessment failed for ${input.name}:`, e.message);
  }
}

webhooks.post("/catalog/:source", (req, res) => {
  if (!config.webhookSecret) return res.status(501).json({ error: "SNOUT_WEBHOOK_SECRET not configured" });

  const sig = req.header("x-snout-signature") || "";
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!raw || !safeEqual(sig, hmacHex(config.webhookSecret, raw))) {
    return res.status(401).json({ error: "Bad signature" });
  }

  const fn = normalize[req.params.source];
  if (!fn) return res.status(400).json({ error: `Unknown source '${req.params.source}'` });

  const items: any[] = ([] as any[]).concat(req.body?.records || req.body || []);
  const inputs = items.map(fn).filter((i) => i.name);
  inputs.forEach(queue);

  res.status(202).json({ accepted: inputs.length });
});
