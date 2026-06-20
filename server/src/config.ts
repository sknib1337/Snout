import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 8787),
  // Origin allowed to call the API from a browser (the web app in dev).
  webOrigin: process.env.WEB_ORIGIN || "http://localhost:5173",
  // Public URL of the web app, used to build "open report" deep links in chat.
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:5173",

  // Anthropic — the agent calls the Messages API with the server-side web_search tool.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",

  // Optional bearer token protecting /api/* (leave blank to disable).
  apiToken: process.env.API_TOKEN || "",

  // Webhook secrets. Routes that depend on a secret return 501 until it is set.
  webhookSecret: process.env.TA_WEBHOOK_SECRET || "",       // inbound catalog HMAC
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET || "",
  teamsSecurityToken: process.env.TEAMS_SECURITY_TOKEN || "", // base64 HMAC key from Teams

  // Where the JSON store writes (swap for Postgres in production — see store.ts).
  dataDir: process.env.DATA_DIR || "./data",
};

export function assertStartup() {
  if (!config.anthropicApiKey) {
    console.warn("[trust-agent] ANTHROPIC_API_KEY is not set — /api/assess will fail until you add it.");
  }
}
