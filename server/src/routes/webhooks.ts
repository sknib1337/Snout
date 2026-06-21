import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { config } from "../config";
import { hmacHex, safeEqual } from "../lib/hmac";
import { assessApp, AssessInput } from "../agent";
import { store } from "../store";
import { idpAdapters, emailToUpsert, sanitizeUpsert, ingestIdp } from "../discovery";
import { sanitizeField, safeUrl } from "../security/sanitize";

export const webhooks = Router();

// Shared HMAC gate for every webhook: fail closed when the secret is unset (501),
// reject a bad/absent signature (401), else return the raw signed body.
function verifiedRaw(req: Request, res: Response): Buffer | null {
  if (!config.webhookSecret) { res.status(501).json({ error: "SNOUT_WEBHOOK_SECRET not configured" }); return null; }
  const sig = req.header("x-snout-signature") || "";
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!raw || !safeEqual(sig, hmacHex(config.webhookSecret, raw))) {
    res.status(401).json({ error: "Bad signature" });
    return null;
  }
  return raw;
}

// Pull a record array out of the common envelopes: Okta (bare array), Microsoft
// Graph (`value`), Google Reports (`items`), or a `records`/`messages` wrapper.
function recordsOf(body: any, key?: string): any[] {
  const arr = body?.[key || "records"] || body?.records || body?.value || body?.items || body?.messages || body || [];
  return ([] as any[]).concat(arr).slice(0, 500);
}

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

// System-of-record catalogs (ServiceNow/Okta app catalog/NetSuite) -> assessments.
webhooks.post("/catalog/:source", (req, res) => {
  if (!verifiedRaw(req, res)) return;

  const fn = normalize[req.params.source];
  if (!fn) return res.status(400).json({ error: `Unknown source '${req.params.source}'` });

  const inputs = recordsOf(req.body).map(fn).filter((i) => i.name);
  inputs.forEach(queue);

  res.status(202).json({ accepted: inputs.length });
});

// IdP sign-in / audit logs (okta|entra|google) -> discovered-app inventory.
// Forward your IdP's log export (or a SIEM/forwarder) here. Events without a
// resolvable app domain are skipped and counted (the store is domain-keyed).
webhooks.post("/idp/:source", async (req, res, next) => {
  if (!config.enableCatalog) return res.status(404).json({ error: "Catalog is disabled" });
  if (!verifiedRaw(req, res)) return;

  if (!idpAdapters[req.params.source]) return res.status(400).json({ error: `Unknown IdP source '${req.params.source}'` });
  try {
    res.status(202).json(await ingestIdp(recordsOf(req.body), req.params.source));
  } catch (e) { next(e); }
});

// SaaS supply-chain breach / CVE feed -> monitoring alerts (EPIC-OPERATE).
webhooks.post("/breach", async (req, res, next) => {
  if (!verifiedRaw(req, res)) return;
  let accepted = 0;
  try {
    for (const r of recordsOf(req.body)) {
      const vendor = sanitizeField(r?.vendor || r?.name || r?.app, 120);
      const title = sanitizeField(r?.title || r?.summary, 200);
      if (!vendor || !title) continue;
      const severity = (["high", "medium", "low"].includes(r?.severity) ? r.severity : "medium") as "high" | "medium" | "low";
      const domain = sanitizeField(r?.domain, 253).toLowerCase();
      await store.addAlert({
        id: randomUUID(),
        kind: /cve/i.test(String(r?.kind || "")) ? "cve" : "breach",
        severity, vendor, domain: domain || undefined,
        title, detail: sanitizeField(r?.detail, 400) || undefined,
        url: safeUrl(r?.url) || undefined, ts: Date.now(),
      });
      accepted++;
    }
    res.status(202).json({ accepted });
  } catch (e) { next(e); }
});

// Forwarded signup/account email metadata -> discovered-app inventory, keyed by the
// sender's domain. Non-signup mail and personal mailboxes are skipped and counted.
webhooks.post("/email", async (req, res, next) => {
  if (!config.enableCatalog) return res.status(404).json({ error: "Catalog is disabled" });
  if (!verifiedRaw(req, res)) return;

  let accepted = 0, skipped = 0;
  try {
    for (const m of recordsOf(req.body, "messages")) {
      const u = sanitizeUpsert(emailToUpsert(m));
      if (!u) { skipped++; continue; }
      await store.upsertDiscovered(u);
      accepted++;
    }
    res.status(202).json({ accepted, skipped });
  } catch (e) { next(e); }
});
