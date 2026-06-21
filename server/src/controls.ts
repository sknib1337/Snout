// The Critical Enterprise SaaS Controls model — the contract the agent fills in
// and the dashboard renders. Scoring is deliberately a transparent mean so any
// stakeholder can audit a number rather than trust a black box.

export const CONTROLS = [
  { key: "sso",            label: "Single Sign-On",      standard: "SAML 2.0 / OIDC" },
  { key: "ulm",            label: "User Lifecycle",      standard: "SCIM 2.0" },
  { key: "entitlements",   label: "Entitlements",        standard: "SCIM groups / RBAC" },
  { key: "riskSignals",    label: "Risk Signal Sharing", standard: "CAEP / SSF" },
  { key: "logout",         label: "Logout",              standard: "RP-initiated / SLO" },
  { key: "tokenRevocation",label: "Token Revocation",    standard: "OAuth 2.0 / CAE" },
] as const;

export type ControlKey = (typeof CONTROLS)[number]["key"];
export type Verdict = "supported" | "partial" | "unsupported" | "unknown";

export const VERDICT_WEIGHT: Record<Verdict, number> = {
  supported: 100, partial: 55, unknown: 25, unsupported: 8,
};

export interface ControlFinding {
  verdict: Verdict;
  standards: string[];
  summary: string;
  citations: { title: string; url: string }[];
}

export interface Assessment {
  id: string;
  app: string;
  vendor: string;
  category: string;
  summary: string;
  score: number;
  recommendation: "Approve" | "Approve with conditions" | "Hold" | "Reject";
  recommendationRationale: string;
  conditions: string[];
  risks: string[];
  ownerMap: { function: string; responsibility: string }[];
  capabilities: Record<ControlKey, ControlFinding>;
  extended: {
    discoverability: string;
    onboardingRecovery: string;
    enterpriseDiscovery: string;
    usageMonitoring: string;
    usageRestrictions: string;
  };
  assessedAt: string;
  // Grounding mode of the run: "web_search" when the provider grounded with live
  // search, "reduced" when it ran without search (verdicts are not citation-backed).
  // Optional so assessments stored before this field remain valid.
  grounding?: "web_search" | "reduced";
}

export function computeScore(capabilities: Partial<Record<ControlKey, ControlFinding>>): number {
  const vals = CONTROLS.map((c) => VERDICT_WEIGHT[capabilities?.[c.key]?.verdict ?? "unknown"]);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function readiness(score: number): "Controls Ready" | "Partial" | "Not Ready" {
  if (score >= 80) return "Controls Ready";
  if (score >= 50) return "Partial";
  return "Not Ready";
}

// Apps discovered in the wild (e.g., by the browser extension) before assessment.
export interface DiscoveredApp {
  domain: string;
  name: string;
  methods: { sso: boolean; social: boolean; password: boolean; federated: boolean; oauthGrant: boolean };
  idps: string[];
  oauth: { idp: string; clientId: string; scopes: string[]; ts: number }[];
  sources: string[];
  firstSeen: number;
  lastSeen: number;
  assessmentId?: string;
}

/** A discovered app is "shadow" unless it authenticated via corporate SSO. */
export function isShadow(app: DiscoveredApp): boolean {
  return !app.methods.sso;
}
