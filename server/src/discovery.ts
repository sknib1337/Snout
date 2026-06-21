// Discovery sensors: turn IdP sign-in/audit logs and forwarded signup emails into
// normalized DiscoveredUpsert records, deduped by domain into the discovered store.
// These run server-side from HMAC-signed webhooks (see routes/webhooks.ts) — they
// make NO outbound calls and store NO IdP/mailbox credentials. Every adapter output
// passes sanitizeUpsert() before it touches the store.
import { sanitizeField } from "./security/sanitize";
import type { DiscoveredUpsert } from "./store";

// A registrable host: 1+ labels + a TLD, lowercased, total <= 253 chars.
export const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/;

// Personal mailbox providers we never catalog as "discovered SaaS".
const CONSUMER_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "gmx.com",
  "proton.me", "protonmail.com", "pm.me", "zoho.com", "fastmail.com", "yandex.com",
]);

function tsOf(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") { const t = Date.parse(v); if (!isNaN(t)) return t; }
  return undefined;
}

/** Derive a registrable host from a URL, an email address, or a bare host string. */
function hostFrom(raw: unknown): string | null {
  let s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@")) s = s.split("@").pop() || "";              // email -> domain part
  if (s.includes("://") || s.startsWith("//")) {
    try { s = new URL(s.startsWith("//") ? "https:" + s : s).hostname; } catch { return null; }
  }
  s = s.replace(/^\[|\]$/g, "").replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "");
  return DOMAIN_RE.test(s) ? s : null;
}

/** First candidate that yields a valid registrable host, else null. */
function resolveDomain(...candidates: unknown[]): string | null {
  for (const c of candidates) { const h = hostFrom(c); if (h) return h; }
  return null;
}

function labelFromDomain(d: string): string {
  const core = d.split(".").slice(0, -1).pop() || d;
  return core.charAt(0).toUpperCase() + core.slice(1);
}

export type IdpAdapter = (record: any) => DiscoveredUpsert | null;

// Adapters tolerant of each IdP's native log shape. They resolve a domain from the
// fields that actually carry one (an explicit `domain` your forwarder can add, an
// app URL, a service-principal URL); events without a resolvable domain are skipped
// and counted (the discovered store is domain-keyed).
export const idpAdapters: Record<string, IdpAdapter> = {
  // Okta System Log event (GET /api/v1/logs).
  okta: (r) => {
    const app = (r.target || []).find((t: any) => t?.type === "AppInstance") || (r.target || [])[0] || {};
    const dd = r.debugContext?.debugData || {};
    const domain = resolveDomain(r.domain, app.alternateId, dd.redirectUri, dd.targetUrl, dd.requestUri);
    if (!domain) return null;
    const ts = tsOf(r.published);
    const et = String(r.eventType || "");
    const consent = /oauth2|consent|grant/i.test(et);
    const scopes = String(dd.scopes ?? dd.scope ?? "").split(/[\s,]+/).filter(Boolean);
    return {
      domain,
      name: app.displayName || labelFromDomain(domain),
      methods: { sso: true, federated: true, oauthGrant: consent },
      idps: ["okta"],
      oauth: consent ? [{ idp: "okta", clientId: String(dd.clientId ?? dd.client_id ?? ""), scopes, ts: ts ?? Date.now() }] : [],
      sources: ["okta-log"],
      lastSeen: ts,
      events: [{ ts: ts ?? Date.now(), source: "okta-log", kind: consent ? "oauth" : "sso", detail: et || "sign-in" }],
    };
  },

  // Microsoft Entra ID sign-in (Microsoft Graph auditLogs/signIns, returned in `value`).
  entra: (r) => {
    const domain = resolveDomain(r.domain, r.servicePrincipalName, r.resourceServicePrincipalName);
    if (!domain) return null;
    const ts = tsOf(r.createdDateTime);
    return {
      domain,
      name: r.appDisplayName || r.resourceDisplayName || labelFromDomain(domain),
      methods: { sso: true },
      idps: ["entra"],
      sources: ["entra-log"],
      lastSeen: ts,
      events: [{ ts: ts ?? Date.now(), source: "entra-log", kind: "signin", detail: r.clientAppUsed || r.appDisplayName || "sign-in" }],
    };
  },

  // Google Workspace Reports API activity (login/token audit, returned in `items`).
  google: (r) => {
    const ev = (r.events || [])[0] || {};
    const params: Record<string, any> = {};
    for (const p of ev.parameters || []) params[p.name] = p.value ?? p.multiValue ?? p.boolValue;
    const domain = resolveDomain(r.domain, params.app_domain, params.application_domain);
    if (!domain) return null;
    const ts = tsOf(r.id?.time);
    const authorize = /authorize|oauth|token/i.test(ev.name || "");
    const scopes = ([] as string[]).concat(params.scope ?? params.app_scopes ?? params.oauth_scopes ?? []).filter(Boolean);
    return {
      domain,
      name: params.app_name || params.application_name || labelFromDomain(domain),
      methods: { sso: true, oauthGrant: authorize },
      idps: ["google"],
      oauth: authorize ? [{ idp: "google", clientId: String(params.oauth_client_id ?? params.client_id ?? ""), scopes, ts: ts ?? Date.now() }] : [],
      sources: ["google-log"],
      lastSeen: ts,
      events: [{ ts: ts ?? Date.now(), source: "google-log", kind: authorize ? "oauth" : "login", detail: ev.name || "login" }],
    };
  },
};

// Subjects / sender local-parts that signal a real signup/account email (vs a
// newsletter or random sender), so email discovery doesn't catalog the whole inbox.
const SIGNUP_SUBJECT_RE = /(welcome|verif|confirm|activat|sign[\s-]?up|signup|get(ting)? started|create.{0,12}account|your account|set up your|password|registration|onboard)/i;
const SIGNUP_SENDER_RE = /^(no-?reply|do-?not-?reply|donotreply|welcome|accounts?|team|hello|notifications?|support|onboarding|members?)/i;

/** Forwarded email metadata -> a discovered app (by the *sender's* domain). */
export function emailToUpsert(m: any): DiscoveredUpsert | null {
  const from = String(m?.from ?? "");
  const addr = (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase();
  const local = (addr.split("@")[0] || "").trim();
  const domain = hostFrom(m?.domain) || hostFrom(addr);
  if (!domain || CONSUMER_MAIL.has(domain)) return null;          // ignore personal mailboxes
  const subject = String(m?.subject ?? "");
  if (!(SIGNUP_SUBJECT_RE.test(subject) || SIGNUP_SENDER_RE.test(local))) return null;
  const ts = tsOf(m?.date) ?? tsOf(m?.ts);
  const display = (from.match(/^([^<]+)</)?.[1] || "").trim().replace(/^"|"$/g, "");
  return {
    domain,
    name: display || labelFromDomain(domain),
    sources: ["email"],
    firstSeen: ts,
    lastSeen: ts,
    events: [{ ts: ts ?? Date.now(), source: "email", kind: "signup", detail: subject.slice(0, 80) || "account email" }],
  };
}

/** Sanitize + bound an adapter's output, validating the domain. Returns null if the
 *  domain is invalid (caller counts it as skipped). Mirrors the caps in routes/catalog. */
export function sanitizeUpsert(u: DiscoveredUpsert | null): DiscoveredUpsert | null {
  if (!u) return null;
  const domain = sanitizeField(u.domain, 253).toLowerCase();
  if (!DOMAIN_RE.test(domain)) return null;
  return {
    domain,
    name: u.name ? sanitizeField(u.name, 80) : undefined,
    methods: u.methods,
    idps: (u.idps || []).map((s) => sanitizeField(s, 253)).filter(Boolean).slice(0, 10),
    oauth: (u.oauth || []).map((o) => ({
      idp: sanitizeField(o.idp, 253),
      clientId: sanitizeField(o.clientId, 120),
      scopes: (o.scopes || []).map((s) => sanitizeField(s, 60)).slice(0, 40),
      ts: o.ts || Date.now(),
    })).slice(0, 10),
    sources: (u.sources || []).map((s) => sanitizeField(s, 40)).filter(Boolean),
    firstSeen: u.firstSeen,
    lastSeen: u.lastSeen,
    events: (u.events || []).map((e) => ({
      ts: typeof e.ts === "number" && isFinite(e.ts) ? e.ts : Date.now(),
      source: sanitizeField(e.source, 40),
      kind: sanitizeField(e.kind, 24),
      detail: e.detail ? sanitizeField(e.detail, 120) : undefined,
    })).slice(0, 20),
  };
}
