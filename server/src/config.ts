import "dotenv/config";
import { safeBaseUrl } from "./security/sanitize";

const env = process.env.NODE_ENV || "development";
const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

export const config = {
  env,
  isProd: env === "production",
  port: num(process.env.PORT, 8787),

  // Comma-separated list of browser origins allowed to call the API.
  webOrigin: (process.env.WEB_ORIGIN || "http://localhost:5173").split(",").map((s) => s.trim()),
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:5173",

  // LLM provider selection. Default "anthropic" keeps the original path unchanged.
  llmProvider: (process.env.LLM_PROVIDER || "anthropic").trim().toLowerCase(),

  // Anthropic — the agent calls the Messages API with the server-side web_search tool.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
  // Operator-configurable base URL so the Anthropic path can run through a proxy or
  // gateway. Trailing slashes trimmed; default is the public API.
  anthropicBaseUrl: (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, ""),

  // OpenAI-compatible provider (LLM_PROVIDER=openai). LLM_BASE_URL is operator-trusted
  // config (may be an internal gateway); it is shape-validated at startup, NOT routed
  // through safeUrl()'s private-host block. LLM_BASE_URL is the root WITHOUT a path.
  llmBaseUrl: (process.env.LLM_BASE_URL || "").replace(/\/+$/, ""),
  llmApiKey: process.env.LLM_API_KEY || "",
  llmModel: process.env.LLM_MODEL || "",

  // Auth. Required in production unless ALLOW_ANON=true (discouraged).
  apiToken: process.env.API_TOKEN || "",
  allowAnon: process.env.ALLOW_ANON === "true",
  // RBAC (EPIC-ENTERPRISE): an optional read-only token. Holders can GET but not
  // mutate. The admin API_TOKEN can do everything.
  viewerToken: process.env.API_VIEWER_TOKEN || "",
  // Tenant tag recorded on the audit log (single-tenant default). True per-tenant
  // data isolation requires the Postgres Store — see SECURITY.md / README.
  tenantId: process.env.TENANT_ID || "default",

  // OIDC dashboard login (optional). When fully configured, users sign in via your
  // IdP and a signed session cookie authorizes API calls (alongside bearer tokens).
  // We only use the ID-token claims for identity; no IdP tokens are stored.
  oidcIssuer: (process.env.OIDC_ISSUER || "").replace(/\/+$/, ""),
  oidcClientId: process.env.OIDC_CLIENT_ID || "",
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET || "",
  oidcRedirectUri: process.env.OIDC_REDIRECT_URI || "",
  oidcScopes: process.env.OIDC_SCOPES || "openid email profile",
  // Claim → role mapping. If OIDC_ADMIN_VALUE is set, only users whose
  // OIDC_ROLE_CLAIM contains it get admin; everyone else is read-only viewer. If
  // it is unset, all authenticated users are admin (no role differentiation).
  oidcRoleClaim: process.env.OIDC_ROLE_CLAIM || "groups",
  oidcAdminValue: process.env.OIDC_ADMIN_VALUE || "",
  // Optional claim whose value scopes the session to a tenant (multi-tenant SSO).
  oidcTenantClaim: process.env.OIDC_TENANT_CLAIM || "",
  // HMAC secret for the signed session + login-transaction cookies.
  sessionSecret: process.env.SESSION_SECRET || "",

  // Trust proxy setting so client IPs (for rate limiting) are accurate behind a proxy.
  trustProxy: process.env.TRUST_PROXY || "loopback",

  // Resource limits (Unrestricted Resource Consumption / Sensitive Business Flows).
  rateLimit: { windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000), max: num(process.env.RATE_LIMIT_MAX, 300) },
  assessRateMax: num(process.env.ASSESS_RATE_MAX, 15),
  maxConcurrentAssessments: num(process.env.MAX_CONCURRENT_ASSESSMENTS, 4),
  bodyLimit: process.env.BODY_LIMIT || "64kb",

  // Webhook secrets. Routes that depend on a secret return 501 until it is set.
  webhookSecret: process.env.SNOUT_WEBHOOK_SECRET || "",
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET || "",
  teamsSecurityToken: process.env.TEAMS_SECURITY_TOKEN || "",

  dataDir: process.env.DATA_DIR || "./data",

  // Persistence backend. Unset → the zero-config JSON store (single-tenant).
  // Set → a Postgres store with per-tenant row scoping (multi-tenant safe).
  databaseUrl: process.env.DATABASE_URL || "",

  // Correctness passes (depth D3), off by default (each adds latency/cost on the
  // web_search path). VERIFY_FINDINGS runs an adversarial refutation LLM pass that
  // demotes unproven verdicts; CHECK_CITATIONS fetches cited pages (SSRF-guarded) and
  // drops citations that don't support the claim.
  verifyFindings: process.env.VERIFY_FINDINGS === "true",
  checkCitations: process.env.CHECK_CITATIONS === "true",
  citationTimeoutMs: num(process.env.CITATION_TIMEOUT_MS, 6000),

  // Scheduled re-assessment (depth D5/EPIC-OPERATE). Off by default (0). When set,
  // apps not assessed within reassessStaleHours are re-run in small batches, which
  // triggers change detection + alerts.
  reassessIntervalHours: num(process.env.REASSESS_INTERVAL_HOURS, 0),
  reassessStaleHours: num(process.env.REASSESS_STALE_HOURS, 168),
  reassessBatch: num(process.env.REASSESS_BATCH, 3),

  // IdP pull-pollers (depth D4, off by default). Zero-touch discovery from sign-in
  // logs using native fetch + stored API credentials (no new dependency). Okta uses
  // an SSWS API token; Entra uses an app registration (client-credentials). Google is
  // not included (its Reports API auth needs JWT signing / an extra dependency).
  oktaLogUrl: (process.env.OKTA_LOG_URL || "").replace(/\/+$/, ""), // e.g. https://org.okta.com/api/v1/logs
  oktaApiToken: process.env.OKTA_API_TOKEN || "",
  entraTenantId: process.env.ENTRA_TENANT_ID || "",
  entraClientId: process.env.ENTRA_CLIENT_ID || "",
  entraClientSecret: process.env.ENTRA_CLIENT_SECRET || "",
  idpPollIntervalMinutes: num(process.env.IDP_POLL_INTERVAL_MINUTES, 0),
  // Google Workspace Reports API poller (service account + domain-wide delegation).
  // Off unless all three are set. The PEM may arrive with escaped newlines.
  googleSaClientEmail: process.env.GOOGLE_SA_CLIENT_EMAIL || "",
  googleSaPrivateKey: (process.env.GOOGLE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  googleAdminSubject: process.env.GOOGLE_ADMIN_SUBJECT || "", // admin user to impersonate via DWD

  // Capability flag: when false, the catalog ingest/discovered routes are not
  // mounted and the dashboard hides the Discovered view (ship with or without
  // the shadow-discovery extension from one build).
  enableCatalog: process.env.ENABLE_CATALOG !== "false",

  // OIDC is active only when fully configured (issuer + client + redirect + secret).
  get oidcEnabled(): boolean {
    return !!(this.oidcIssuer && this.oidcClientId && this.oidcClientSecret && this.oidcRedirectUri && this.sessionSecret);
  },
};

// True when the selected provider has everything it needs to actually run an
// assessment. Anthropic needs a key; an OpenAI-compatible endpoint needs base+key+model.
export function providerConfigured(): boolean {
  if (config.llmProvider === "anthropic") return !!config.anthropicApiKey;
  if (config.llmProvider === "openai") return !!(config.llmBaseUrl && config.llmApiKey && config.llmModel);
  return false;
}

// Operator-facing readiness snapshot — booleans only, NEVER secret values. Powers the
// dashboard's honest status badge + setup checklist (EPIC-ACTIVATION) so a first-run
// operator can see exactly what is and isn't configured.
export function readiness() {
  const assessReady = providerConfigured();
  return {
    env: config.env,
    provider: config.llmProvider,
    model: config.llmProvider === "anthropic" ? config.anthropicModel : config.llmModel,
    assessReady,                                       // can /api/assess actually run?
    webSearch: config.llmProvider === "anthropic" && assessReady, // only this path has live grounding
    store: config.databaseUrl ? "postgres" : "json",
    catalog: config.enableCatalog,
    webhooks: !!config.webhookSecret,
    oidc: config.oidcEnabled,
  };
}

// A safe, env-var-naming hint for why assessments can't run yet (no secret values).
export function providerSetupHint(): string {
  return config.llmProvider === "anthropic"
    ? "No LLM provider key configured. Set ANTHROPIC_API_KEY on the server and restart."
    : "LLM provider not fully configured. Set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL on the server and restart.";
}

export function assertStartup() {
  // Validate the SELECTED provider's config. Anthropic stays warn-only (unchanged:
  // the server may run without a key for non-assess use); new providers fail closed.
  const provider = config.llmProvider;
  if (provider === "anthropic") {
    if (!config.anthropicApiKey) {
      console.warn("[snout] ANTHROPIC_API_KEY is not set — /api/assess will fail until you add it.");
    }
  } else if (provider === "openai") {
    const missing = ([
      ["LLM_BASE_URL", config.llmBaseUrl],
      ["LLM_API_KEY", config.llmApiKey],
      ["LLM_MODEL", config.llmModel],
    ] as const).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      throw new Error(`LLM_PROVIDER=${provider} requires ${missing.join(", ")}. Set them, or use LLM_PROVIDER=anthropic.`);
    }
  } else {
    throw new Error(`Unknown LLM_PROVIDER "${provider}". Use "anthropic" or "openai".`);
  }

  // Operator base URLs are trusted config (may be internal hosts) but still get a
  // light shape check — http(s) only, no embedded credentials. Fail closed if bad.
  if (process.env.ANTHROPIC_BASE_URL && !safeBaseUrl(config.anthropicBaseUrl)) {
    throw new Error("ANTHROPIC_BASE_URL must be a valid http(s) URL without embedded credentials.");
  }
  if (config.llmBaseUrl && !safeBaseUrl(config.llmBaseUrl)) {
    throw new Error("LLM_BASE_URL must be a valid http(s) URL without embedded credentials.");
  }
  if (config.oktaLogUrl && !safeBaseUrl(config.oktaLogUrl)) {
    throw new Error("OKTA_LOG_URL must be a valid http(s) URL without embedded credentials.");
  }

  // OIDC: all-or-nothing. A partial config is a footgun (a login route that
  // half-works), so fail closed if some but not all required vars are set.
  const oidcVars = {
    OIDC_ISSUER: config.oidcIssuer, OIDC_CLIENT_ID: config.oidcClientId,
    OIDC_CLIENT_SECRET: config.oidcClientSecret, OIDC_REDIRECT_URI: config.oidcRedirectUri,
    SESSION_SECRET: config.sessionSecret,
  };
  const setKeys = Object.entries(oidcVars).filter(([, v]) => v).map(([k]) => k);
  if (setKeys.length > 0 && setKeys.length < Object.keys(oidcVars).length) {
    const missing = Object.entries(oidcVars).filter(([, v]) => !v).map(([k]) => k);
    throw new Error(`Incomplete OIDC config: set all of ${Object.keys(oidcVars).join(", ")} or none. Missing: ${missing.join(", ")}.`);
  }
  if (config.oidcEnabled) {
    if (!safeBaseUrl(config.oidcIssuer)) throw new Error("OIDC_ISSUER must be a valid http(s) URL without embedded credentials.");
    if (config.isProd && config.sessionSecret.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters in production.");
    }
  }

  // Fail closed: no anonymous, unauthenticated API in production.
  if (config.isProd && !config.apiToken && !config.allowAnon) {
    throw new Error(
      "Refusing to start in production without API_TOKEN. Set API_TOKEN, or set ALLOW_ANON=true if the server sits behind your own authenticating gateway.",
    );
  }
}
