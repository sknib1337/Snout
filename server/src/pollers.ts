// IdP pull-pollers (depth D4). Zero-touch discovery: periodically pull sign-in/audit
// logs from Okta, Microsoft Entra, and Google Workspace and feed them through the same
// idpAdapters used by the push webhooks. Off unless configured.
//
// Security: outbound calls go ONLY to operator-configured/well-known IdP hosts; Okta's
// URL is validated by safeBaseUrl() at startup, Entra and Google use fixed vendor hosts.
// Credentials (Okta SSWS token, Entra client secret, Google service-account key) live in
// env and are never logged. Google's Reports API auth needs a signed JWT assertion,
// provided by `jose` (loaded lazily; the only added dependency on this path).
import { config } from "./config";
import { ingestIdp } from "./discovery";
import { importESM } from "./esm";

type PollResult = { accepted: number; skipped: number } | null;

// Cursor so each poll only pulls new events (in-memory; resets on restart).
let oktaSince: string | null = null;
let googleSince: string | null = null;

/** Pull recent Okta System Log events. No-op unless OKTA_LOG_URL + OKTA_API_TOKEN set. */
export async function pollOkta(): Promise<PollResult> {
  if (!config.oktaLogUrl || !config.oktaApiToken) return null;
  const since = oktaSince || new Date(Date.now() - 24 * 3600e3).toISOString();
  const sep = config.oktaLogUrl.includes("?") ? "&" : "?";
  const url = `${config.oktaLogUrl}${sep}since=${encodeURIComponent(since)}&limit=200`;
  const res = await fetch(url, { headers: { authorization: `SSWS ${config.oktaApiToken}`, accept: "application/json" } });
  if (!res.ok) throw new Error(`Okta logs ${res.status}`);
  const events = await res.json();
  oktaSince = new Date().toISOString();
  return ingestIdp(Array.isArray(events) ? events : [], "okta");
}

/** Pull recent Entra sign-ins via Graph (client-credentials). No-op unless configured. */
export async function pollEntra(): Promise<PollResult> {
  if (!config.entraTenantId || !config.entraClientId || !config.entraClientSecret) return null;
  const tok = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.entraTenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.entraClientId,
      client_secret: config.entraClientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!tok.ok) throw new Error(`Entra token ${tok.status}`);
  const { access_token } = await tok.json();
  const res = await fetch("https://graph.microsoft.com/v1.0/auditLogs/signIns?$top=200", {
    headers: { authorization: `Bearer ${access_token}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Graph signIns ${res.status}`);
  const body = await res.json();
  return ingestIdp(Array.isArray(body?.value) ? body.value : [], "entra");
}

// Mint a short-lived Google API access token: sign a service-account JWT assertion
// (RS256, via jose) impersonating the configured admin (domain-wide delegation),
// then exchange it at Google's fixed token endpoint for the read-only Reports scope.
async function googleAccessToken(): Promise<string> {
  const jose = await importESM<typeof import("jose")>("jose");
  const now = Math.floor(Date.now() / 1000);
  const key = await jose.importPKCS8(config.googleSaPrivateKey, "RS256");
  const assertion = await new jose.SignJWT({ scope: "https://www.googleapis.com/auth/admin.reports.audit.readonly" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(config.googleSaClientEmail)
    .setSubject(config.googleAdminSubject)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}`);
  const { access_token } = await res.json();
  return access_token;
}

/**
 * Pull recent Google Workspace login + token (OAuth grant) audit activity via the
 * Admin SDK Reports API. No-op unless the service-account credentials + admin
 * subject are set. Outbound only to Google's fixed hosts; the SA key lives in env
 * and is never logged.
 */
export async function pollGoogle(): Promise<PollResult> {
  if (!config.googleSaClientEmail || !config.googleSaPrivateKey || !config.googleAdminSubject) return null;
  const token = await googleAccessToken();
  const startTime = googleSince || new Date(Date.now() - 24 * 3600e3).toISOString();
  const items: any[] = [];
  for (const app of ["login", "token"]) {
    const url = `https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/${app}?maxResults=200&startTime=${encodeURIComponent(startTime)}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    if (!res.ok) throw new Error(`Google reports ${app} ${res.status}`);
    const body = await res.json();
    if (Array.isArray(body?.items)) items.push(...body.items);
  }
  googleSince = new Date().toISOString();
  return ingestIdp(items, "google");
}

/** Start the periodic pollers if an interval is configured (no-op otherwise). */
export function startPollers() {
  if (config.idpPollIntervalMinutes <= 0) return;
  const ms = config.idpPollIntervalMinutes * 60e3;
  const run = async () => {
    for (const [name, fn] of [["okta", pollOkta], ["entra", pollEntra], ["google", pollGoogle]] as const) {
      try {
        const r = await fn();
        if (r) console.log(`[poll:${name}] +${r.accepted} discovered (skipped ${r.skipped})`);
      } catch (e: any) {
        console.error(`[poll:${name}] ${e.message}`);
      }
    }
  };
  console.log(`[poll] IdP pollers every ${config.idpPollIntervalMinutes}m`);
  setInterval(run, ms).unref?.();
}
