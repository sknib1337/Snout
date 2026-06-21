// IdP pull-pollers (depth D4). Zero-touch discovery: periodically pull sign-in/audit
// logs from Okta and Microsoft Entra and feed them through the same idpAdapters used by
// the push webhooks. Native fetch only — no new dependency. Off unless configured.
//
// Security: outbound calls go ONLY to operator-configured/well-known IdP hosts; Okta's
// URL is validated by safeBaseUrl() at startup. Credentials (Okta SSWS token, Entra
// client secret) live in env and are never logged. Google is intentionally omitted —
// its Reports API auth needs JWT signing (an extra dependency).
import { config } from "./config";
import { ingestIdp } from "./discovery";

type PollResult = { accepted: number; skipped: number } | null;

// Cursor so each poll only pulls new events (in-memory; resets on restart).
let oktaSince: string | null = null;

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

/** Start the periodic pollers if an interval is configured (no-op otherwise). */
export function startPollers() {
  if (config.idpPollIntervalMinutes <= 0) return;
  const ms = config.idpPollIntervalMinutes * 60e3;
  const run = async () => {
    for (const [name, fn] of [["okta", pollOkta], ["entra", pollEntra]] as const) {
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
