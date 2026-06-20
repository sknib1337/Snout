// Pure classification helpers, shared by the service worker and the popup.

const TWO_LEVEL = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au",
  "co.jp", "co.nz", "co.in", "com.br", "com.mx", "co.za", "com.sg", "com.hk",
]);

export function registrableDomain(host) {
  host = (host || "").toLowerCase().replace(/\.$/, "");
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join(".");
  if (TWO_LEVEL.has(last2)) return parts.slice(-3).join(".");
  return last2;
}

export function guessName(domain) {
  const label = registrableDomain(domain).split(".")[0] || domain;
  return label.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Consumer / social identity providers. Authenticating to a SaaS app via one of
// these (and not your corporate IdP) is shadow auth.
const CONSUMER_IDP = [
  "accounts.google.com", "appleid.apple.com", "facebook.com", "www.facebook.com",
  "github.com", "gitlab.com", "login.yahoo.com", "linkedin.com", "www.linkedin.com",
  "twitter.com", "x.com", "api.twitter.com", "discord.com", "login.live.com",
  "slack.com", "id.atlassian.com",
];

// Well-known enterprise IdP host fragments — used only to recognise that *some*
// federated SSO happened; whether it's sanctioned depends on the user's corp list.
const ENTERPRISE_IDP_HINTS = [
  "okta.com", "oktapreview.com", "onelogin.com", "pingidentity.com", "pingone.com",
  "auth0.com", "microsoftonline.com", "jumpcloud.com", "duosecurity.com",
  "cloudflareaccess.com", "miniorange.com", "fusionauth", "workos.com",
];

function hostMatches(host, list) {
  host = (host || "").toLowerCase();
  return list.some((d) => host === d || host.endsWith("." + d) || host.endsWith(d));
}

/** Parse an OAuth/OIDC or SAML auth URL. Returns null if not an auth flow. */
export function parseAuth(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  const q = u.searchParams;

  const looksOauth =
    path.includes("/authorize") || path.includes("/oauth2") || path.includes("/o/oauth2") ||
    path.includes("/oauth/authorize") || (q.has("response_type") && q.has("client_id"));
  if (looksOauth) {
    let appDomain = "";
    try { appDomain = registrableDomain(new URL(q.get("redirect_uri")).hostname); } catch { /* none */ }
    return {
      kind: "oauth", idpHost: host, appDomain,
      clientId: (q.get("client_id") || "").slice(0, 120),
      scopes: (q.get("scope") || "").split(/[\s+]+/).filter(Boolean).slice(0, 30),
    };
  }
  if (q.has("SAMLRequest") || q.has("SAMLResponse") || path.includes("/saml")) {
    return { kind: "saml", idpHost: host, appDomain: "", clientId: "", scopes: [] };
  }
  return null;
}

export function classifyIdp(idpHost, corpIdpDomains = []) {
  if (corpIdpDomains.length && hostMatches(idpHost, corpIdpDomains)) return "corp";
  if (hostMatches(idpHost, CONSUMER_IDP)) return "consumer";
  if (hostMatches(idpHost, ENTERPRISE_IDP_HINTS)) return "enterprise"; // federated, but not your sanctioned IdP
  return "other";
}

/** An app is sanctioned if explicitly allow-listed or it authenticated via the
 *  corporate IdP. Everything else is shadow. */
export function isSanctioned(app, settings) {
  const sanctionedApps = settings.sanctionedApps || [];
  if (sanctionedApps.some((d) => app.domain === d || app.domain.endsWith("." + d))) return true;
  return !!app.methods?.sso; // sso flag is only set when the corp IdP was used
}

/** Human-facing posture label + tone for an app. */
export function posture(app, settings) {
  if (isSanctioned(app, settings)) return { label: "Sanctioned", tone: "green" };
  if (app.methods?.password) return { label: "Local password", tone: "red" };
  if (app.methods?.social) return { label: "Social login", tone: "amber" };
  if (app.methods?.federated) return { label: "Unknown IdP", tone: "amber" };
  return { label: "Unsanctioned", tone: "amber" };
}
