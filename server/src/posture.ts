// Auth-posture findings (EPIC-VISIBILITY). Derives identity-risk findings from a
// discovered app's observed auth methods + OAuth grants — the gaps Push-style ITDR
// surfaces — as *findings*, not inline enforcement (see README "Scope"). Pure and
// deterministic so it can enrich any catalog response and feed a SIEM export.
import { DiscoveredApp } from "./controls";

export type Severity = "high" | "medium" | "low";
export interface PostureFinding { id: string; severity: Severity; title: string; detail: string; }

// Tiered OAuth scope risk (depth D5): write/admin scopes are high; broad read access
// is medium; long-lived (offline) tokens are low.
const HIGH_SCOPE_RE = /(^|[._:/])(admin|write|delete|manage|modify|full|owner|read_write|readwrite|root|superuser)([._:/]|$)/i;
const BROAD_SCOPE_RE = /(^|[._:/])(mail|email|drive|files?|contacts?|calendar|directory|all|read)([._:/]|$)/i;
const OFFLINE_RE = /offline_access|refresh_token/i;
const SEV_WEIGHT: Record<Severity, number> = { high: 40, medium: 20, low: 8 };

/** Identity-posture findings + an aggregate risk score (0 = clean, 100 = worst). */
export function posture(app: DiscoveredApp): { findings: PostureFinding[]; riskScore: number } {
  const f: PostureFinding[] = [];
  const m = app.methods || ({} as DiscoveredApp["methods"]);

  if (!m.sso) f.push({ id: "no-sso", severity: "high", title: "No corporate SSO", detail: "Authenticated without a corporate IdP — access isn't centrally governed (shadow auth)." });
  if (m.password) f.push({ id: "local-password", severity: "high", title: "Local password login", detail: "A local username/password was used — credentials live outside IdP control (reuse / phishing risk)." });
  if (m.social) f.push({ id: "consumer-idp", severity: "medium", title: "Consumer / social IdP", detail: "Signed in via a consumer identity provider instead of the corporate IdP." });

  const high = new Set<string>(), broad = new Set<string>();
  let offline = false;
  for (const g of app.oauth || []) for (const s of g.scopes || []) {
    if (HIGH_SCOPE_RE.test(s)) high.add(s);
    else if (BROAD_SCOPE_RE.test(s)) broad.add(s);
    if (OFFLINE_RE.test(s)) offline = true;
  }
  if (high.size) f.push({ id: "high-oauth-scope", severity: "high", title: `Write/admin OAuth scopes (${high.size})`, detail: `Granted high-risk scopes: ${[...high].slice(0, 6).join(", ")}.` });
  if (broad.size) f.push({ id: "broad-oauth-scope", severity: "medium", title: `Broad OAuth scopes (${broad.size})`, detail: `Granted broad read scopes: ${[...broad].slice(0, 6).join(", ")}.` });
  if (offline) f.push({ id: "offline-token", severity: "low", title: "Long-lived token", detail: "App holds a refresh/offline token for persistent access." });
  if (m.federated && !m.sso) f.push({ id: "non-corp-federation", severity: "low", title: "Non-corporate federation", detail: "Federated login observed that isn't your corporate IdP." });

  const riskScore = Math.min(100, f.reduce((a, x) => a + SEV_WEIGHT[x.severity], 0));
  return { findings: f, riskScore };
}

/** Highest severity present, for a quick badge. */
export function topSeverity(findings: PostureFinding[]): Severity | null {
  if (findings.some((x) => x.severity === "high")) return "high";
  if (findings.some((x) => x.severity === "medium")) return "medium";
  if (findings.some((x) => x.severity === "low")) return "low";
  return null;
}
