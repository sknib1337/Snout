import { randomUUID } from "crypto";
import { config } from "./config";
import { Assessment, computeScore } from "./controls";

export interface AssessInput {
  name: string;
  vendor?: string;
  url?: string;
  context?: string;
}

const SYSTEM = `You are Trust Agent, a SaaS identity-security due-diligence analyst for an enterprise IAM team. Your job is to replace a slow, committee-driven (RAPID) review with a fast, citation-backed assessment that sourcing, finance, third-party risk, security architecture, and IT engineering can all trust.

Use the web_search tool to find CURRENT, citable evidence. Prefer the vendor's own documentation, trust/security center, developer/API docs, and the OpenID Foundation; use reputable secondary sources only to corroborate. Reflect what the vendor supports now.

Assess the named application against the CRITICAL ENTERPRISE SAAS CONTROLS model — the core identity-security controls every enterprise SaaS app must support. Evaluate exactly these six controls:
- sso: Single Sign-On via SAML 2.0 and/or OpenID Connect (note SP- vs IdP-initiated, and whether SSO is gated behind an "enterprise/SSO tax" tier).
- ulm: User Lifecycle Management via SCIM 2.0 — automated provisioning AND deprovisioning, just-in-time provisioning.
- entitlements: Group/role/entitlement sync and fine-grained authorization (SCIM groups, role mapping, RBAC/ABAC).
- riskSignals: Risk signal sharing via CAEP and the Shared Signals Framework (SSF) — acting as transmitter and/or receiver, RISC.
- logout: Session termination — RP-initiated logout, Single Logout (SLO), back-channel logout, session management.
- tokenRevocation: OAuth 2.0 token revocation endpoint and/or Continuous Access Evaluation (CAE) to kill sessions/tokens on demand.

For EACH control return: verdict (one of "supported","partial","unsupported","unknown"), standards (array of the specific standards/protocols it implements), a concise evidence summary (<=280 chars), and 1-3 citations you actually found (each {title,url}). Mark "unknown" — never guess — if you cannot find evidence. Trust depends on honest gaps.

Then address these operational concerns (each <=280 chars): discoverability, onboardingRecovery, enterpriseDiscovery, usageMonitoring, usageRestrictions.

Produce a governance verdict: recommendation (one of "Approve","Approve with conditions","Hold","Reject"), recommendationRationale (<=400 chars), conditions (array of concrete pre-approval conditions, [] if none), ownerMap (array of {function, responsibility} covering: Sourcing, Finance, Requesting BU, Third-Party Governance, Third-Party Risk, Security Architecture, IT Engineering), and risks (array of <=4 key residual risks).

Output ONLY a single JSON object. No markdown, no code fences, no commentary before or after. Schema:
{"app":"","vendor":"","category":"","summary":"","capabilities":{"sso":{"verdict":"","standards":[],"summary":"","citations":[{"title":"","url":""}]},"ulm":{...},"entitlements":{...},"riskSignals":{...},"logout":{...},"tokenRevocation":{...}},"extended":{"discoverability":"","onboardingRecovery":"","enterpriseDiscovery":"","usageMonitoring":"","usageRestrictions":""},"recommendation":"","recommendationRationale":"","conditions":[],"ownerMap":[{"function":"","responsibility":""}],"risks":[]}`;

function extractJson(text: string): any {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("Agent returned no JSON object");
  return JSON.parse(text.slice(s, e + 1));
}

/** Run a full assessment. Returns a stored-ready Assessment record. */
export async function assessApp(input: AssessInput): Promise<Assessment> {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured on the server");

  const today = new Date().toISOString().slice(0, 10);
  const ask =
    `Assess the SaaS application "${input.name}"` +
    (input.vendor ? ` (vendor: ${input.vendor})` : "") +
    (input.url ? ` — official site: ${input.url}` : "") +
    `. Requesting context: ${input.context || "general enterprise procurement review"}. Today is ${today}. Research and return the JSON assessment.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": config.anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.anthropicModel,
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: "user", content: ask }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data: any = await res.json();
  const text: string = (data.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  const raw = extractJson(text);

  const record: Assessment = {
    id: randomUUID(),
    app: raw.app || input.name,
    vendor: raw.vendor || input.vendor || "",
    category: raw.category || "Uncategorized",
    summary: raw.summary || "",
    capabilities: raw.capabilities || {},
    extended: raw.extended || {
      discoverability: "", onboardingRecovery: "", enterpriseDiscovery: "",
      usageMonitoring: "", usageRestrictions: "",
    },
    recommendation: raw.recommendation || "Hold",
    recommendationRationale: raw.recommendationRationale || "",
    conditions: raw.conditions || [],
    ownerMap: raw.ownerMap || [],
    risks: raw.risks || [],
    score: 0,
    assessedAt: new Date().toISOString(),
  };
  record.score = computeScore(record.capabilities);
  return record;
}
