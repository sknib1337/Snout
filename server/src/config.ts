import "dotenv/config";

const env = process.env.NODE_ENV || "development";
const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

export const config = {
  env,
  isProd: env === "production",
  port: num(process.env.PORT, 8787),

  // Comma-separated list of browser origins allowed to call the API.
  webOrigin: (process.env.WEB_ORIGIN || "http://localhost:5173").split(",").map((s) => s.trim()),
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:5173",

  // Anthropic — the agent calls the Messages API with the server-side web_search tool.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",

  // Auth. Required in production unless ALLOW_ANON=true (discouraged).
  apiToken: process.env.API_TOKEN || "",
  allowAnon: process.env.ALLOW_ANON === "true",

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

  // Capability flag: when false, the catalog ingest/discovered routes are not
  // mounted and the dashboard hides the Discovered view (ship with or without
  // the shadow-discovery extension from one build).
  enableCatalog: process.env.ENABLE_CATALOG !== "false",
};

export function assertStartup() {
  if (!config.anthropicApiKey) {
    console.warn("[snout] ANTHROPIC_API_KEY is not set — /api/assess will fail until you add it.");
  }
  // Fail closed: no anonymous, unauthenticated API in production.
  if (config.isProd && !config.apiToken && !config.allowAnon) {
    throw new Error(
      "Refusing to start in production without API_TOKEN. Set API_TOKEN, or set ALLOW_ANON=true if the server sits behind your own authenticating gateway.",
    );
  }
}
