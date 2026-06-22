// Citation grounding (depth D3). safeUrl() only validates a citation's *shape*; this
// checks the cited page actually mentions the control/standard, and drops citations that
// don't. Outbound fetch is SSRF-guarded: safeUrl() (public http(s) only) + redirect:"manual"
// (never chase a redirect to a private host) + timeout + size cap. Off by default.
import { ControlKey, ControlFinding } from "./controls";
import { safeUrl } from "./security/sanitize";

const CONTROL_KEYWORDS: Record<ControlKey, string[]> = {
  sso: ["sso", "single sign-on", "single sign on", "saml", "oidc", "openid"],
  ulm: ["scim", "provision", "deprovision", "lifecycle", "just-in-time"],
  entitlements: ["scim", "group", "role", "rbac", "abac", "entitlement", "permission"],
  riskSignals: ["caep", "shared signals", "ssf", "risc", "risk signal", "continuous access"],
  logout: ["logout", "log out", "single logout", "slo", "session", "back-channel"],
  tokenRevocation: ["revoke", "revocation", "token", "oauth", "cae", "continuous access evaluation"],
};

/** Does the page text support the control claim? (control keyword OR a cited standard OR the vendor) */
export function citationMatches(text: string, control: ControlKey, standards: string[], vendor?: string): boolean {
  const hay = (text || "").toLowerCase();
  if (!hay) return false;
  const needles = [
    ...CONTROL_KEYWORDS[control],
    ...standards.map((s) => s.toLowerCase()),
    ...(vendor ? [vendor.toLowerCase()] : []),
  ].filter(Boolean);
  return needles.some((n) => hay.includes(n));
}

/** SSRF-guarded text fetch. Returns the (size-capped) body, or null if it can't be
 *  safely fetched. Does NOT follow redirects (a redirect could point at a private host). */
export async function fetchText(url: string, timeoutMs = 6000, maxBytes = 500_000): Promise<string | null> {
  const safe = safeUrl(url);
  if (!safe) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(safe, {
      redirect: "manual", // SSRF guard: don't chase redirects to private hosts
      signal: ctrl.signal,
      headers: { accept: "text/html,text/plain", "user-agent": "Snout-citation-check" },
    });
    if (res.status < 200 || res.status >= 300) return null; // redirects/errors → unverifiable
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.subarray(0, maxBytes).toString("utf8");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Drop citations whose page does NOT support the control. A citation that can't be
 *  fetched (network/JS-rendered) is KEPT — we only drop on a positive mismatch, to
 *  avoid false drops. Returns the capabilities with filtered citations. */
export async function groundFindings(
  caps: Record<ControlKey, ControlFinding>,
  vendor: string | undefined,
  opts: { timeoutMs?: number } = {},
): Promise<Record<ControlKey, ControlFinding>> {
  const out = {} as Record<ControlKey, ControlFinding>;
  for (const k of Object.keys(caps) as ControlKey[]) {
    const f = caps[k];
    if (f.source === "kb-verified" || !f.citations.length) { out[k] = f; continue; }
    const kept: { title: string; url: string }[] = [];
    for (const c of f.citations) {
      const text = await fetchText(c.url, opts.timeoutMs);
      if (text === null || citationMatches(text, k, f.standards, vendor)) kept.push(c); // keep if unverifiable or matching
    }
    out[k] = { ...f, citations: kept };
  }
  return out;
}
