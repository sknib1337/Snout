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
  // Per-control confidence (0..1) and where the finding came from. Optional so
  // assessments stored before the knowledge base existed remain valid.
  confidence?: number;
  source?: "kb-verified" | "agent" | "kb-proposed";
}

// --- Knowledge base (EPIC-MOAT) -------------------------------------------
// An open, per-vendor, per-control record of IPSIE-control support that is
// reused across assessments. Seed facts live in repo files under kb/; human
// verifications/overrides are persisted by the Store. Only human-verified facts
// are injected into the agent as trusted priors.
export type FactSource = "human" | "agent" | "seed";

export interface ControlFact {
  verdict: Verdict;
  confidence: number; // 0..1
  standards: string[];
  summary: string;
  citations: { title: string; url: string }[];
  source: FactSource;
  verifiedBy?: string;
  verifiedAt?: string;
}

export interface KbVendor {
  vendor: string;
  domain: string;
  updatedAt: string;
  controls: Partial<Record<ControlKey, ControlFact>>;
}

// --- Continuous monitoring (EPIC-OPERATE) ---------------------------------
// An alert raised by a sensor: a breach/CVE feed item, or a detected control
// regression on re-assessment.
export interface Alert {
  id: string;
  kind: "breach" | "cve" | "change";
  severity: "high" | "medium" | "low";
  vendor: string;
  domain?: string;
  title: string;
  detail?: string;
  url?: string;
  ts: number;
}

// One control verdict that changed between consecutive assessments of an app.
export interface AssessmentChange { control: ControlKey; from: Verdict; to: Verdict; }

// --- Audit log (EPIC-ENTERPRISE) ------------------------------------------
// A record of every mutating API call: who (role), which tenant, what, outcome.
export interface AuditEntry {
  id: string;
  ts: number;
  requestId?: string;
  role: string;
  tenant: string;
  method: string;
  path: string;
  status?: number;
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
  // Resolved knowledge-base key (domain or vendor slug) for verify/override reuse.
  kbKey?: string;
  // Control verdicts that changed vs the previous assessment of this app (EPIC-OPERATE).
  changes?: AssessmentChange[];
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

// One append-only discovery observation, so the inventory shows *how* and *when*
// each app/auth signal was seen (which sensor, what it observed). Capped per app.
export interface DiscoveredEvent {
  ts: number;
  source: string; // sensor: "extension" | "okta-log" | "entra-log" | "google-log" | "email" | ...
  kind: string;   // "sso" | "oauth" | "signin" | "login" | "signup" | ...
  detail?: string;
}

// Apps discovered in the wild (browser extension, IdP sign-in logs, signup emails)
// before assessment. Keyed by domain; sensors are deduped/merged into one record.
export interface DiscoveredApp {
  domain: string;
  name: string;
  methods: { sso: boolean; social: boolean; password: boolean; federated: boolean; oauthGrant: boolean };
  idps: string[];
  oauth: { idp: string; clientId: string; scopes: string[]; ts: number }[];
  sources: string[];
  firstSeen: number;
  lastSeen: number;
  events?: DiscoveredEvent[]; // discovery history (optional; older records have none)
  assessmentId?: string;
}

/** A discovered app is "shadow" unless it authenticated via corporate SSO. */
export function isShadow(app: DiscoveredApp): boolean {
  return !app.methods.sso;
}
