// Seed data for the offline demo build (VITE_DEMO=true). No server or API key.
// Representative spread: a clean Approve, an Approve-with-conditions, and a Reject,
// plus a Discovered (shadow) inventory that tells the discovery -> assess story.

const cite = (title, url) => ({ title, url });

function controls(map) {
  const out = {};
  for (const k of ["sso", "ulm", "entitlements", "riskSignals", "logout", "tokenRevocation"]) {
    out[k] = map[k] || { verdict: "unknown", standards: [], summary: "No public evidence found.", citations: [] };
  }
  return out;
}

export const DEMO_ASSESSMENTS = [
  {
    id: "a-okta", app: "Workday", vendor: "Workday, Inc.", category: "HCM / Finance",
    score: 92, recommendation: "Approve",
    summary: "Mature enterprise identity surface. Full SAML/OIDC SSO, SCIM provisioning, and OAuth token revocation. Risk-signal sharing is emerging but not yet CAEP-native.",
    recommendationRationale: "Meets all critical access controls for a production-exposed system of record. Approve for procurement.",
    conditions: [],
    risks: ["CAEP/SSF receiver support still on roadmap — continuous access evaluation is polling-based today."],
    ownerMap: [
      { function: "Security Architecture", responsibility: "Validate SAML signing + SCIM scopes at onboarding." },
      { function: "IT Engineering", responsibility: "Wire SCIM to Workforce; enforce SSO-only sign-in." },
      { function: "Third-Party Risk", responsibility: "File SOC 2 Type II + annual re-attestation." },
    ],
    capabilities: controls({
      sso: { verdict: "supported", standards: ["SAML 2.0", "OIDC"], summary: "SP- and IdP-initiated SAML and OIDC; SSO available on all enterprise tiers.", citations: [cite("Workday SSO configuration", "https://doc.workday.com/")] },
      ulm: { verdict: "supported", standards: ["SCIM 2.0"], summary: "SCIM 2.0 provisioning and deprovisioning with JIT.", citations: [cite("Workday SCIM connector", "https://doc.workday.com/")] },
      entitlements: { verdict: "supported", standards: ["SCIM groups", "RBAC"], summary: "Role and security-group sync via SCIM.", citations: [cite("Security groups", "https://doc.workday.com/")] },
      riskSignals: { verdict: "partial", standards: ["RISC"], summary: "RISC events emitted; full CAEP/SSF receiver on roadmap.", citations: [cite("Shared Signals", "https://openid.net/wg/sharedsignals/")] },
      logout: { verdict: "supported", standards: ["SLO"], summary: "RP-initiated logout and Single Logout supported.", citations: [cite("Session management", "https://doc.workday.com/")] },
      tokenRevocation: { verdict: "supported", standards: ["OAuth 2.0"], summary: "OAuth 2.0 token revocation endpoint exposed.", citations: [cite("OAuth API", "https://doc.workday.com/")] },
    }),
    extended: {
      discoverability: "Well-documented enterprise admin surface; integrations published.",
      onboardingRecovery: "Break-glass admin + delegated admin recovery documented.",
      enterpriseDiscovery: "Discoverable via Okta Integration Network and SCIM.",
      usageMonitoring: "Audit logs streamable to SIEM.",
      usageRestrictions: "IP allowlisting + adaptive auth available.",
    },
    assessedAt: new Date(Date.now() - 86400e3 * 2).toISOString(),
  },
  {
    id: "a-figma", app: "Figma", vendor: "Figma, Inc.", category: "Design / Collaboration",
    score: 64, recommendation: "Approve with conditions",
    summary: "SSO and SCIM are solid on the Organization/Enterprise tiers, but risk-signal sharing and token revocation are limited. SSO is gated behind a higher tier (an 'SSO tax').",
    recommendationRationale: "Acceptable for collaboration data if provisioned on the Enterprise tier with SCIM enforced. Conditions required before production rollout.",
    conditions: [
      "Purchase Enterprise tier to unlock SAML SSO (not available on lower tiers).",
      "Enforce SCIM deprovisioning tied to Workforce offboarding.",
      "Restrict external file sharing by policy.",
    ],
    risks: [
      "No CAEP/SSF support — compromised sessions can't be force-revoked in real time.",
      "SSO gated behind premium tier increases cost of secure deployment.",
    ],
    ownerMap: [
      { function: "Sourcing", responsibility: "Negotiate Enterprise tier; confirm SSO is included." },
      { function: "Security Architecture", responsibility: "Verify SCIM deprovisioning end-to-end." },
      { function: "Requesting BU", responsibility: "Own external-sharing policy exceptions." },
    ],
    capabilities: controls({
      sso: { verdict: "partial", standards: ["SAML 2.0"], summary: "SAML SSO available, but only on the Enterprise tier (SSO tax).", citations: [cite("Figma SSO", "https://help.figma.com/")] },
      ulm: { verdict: "supported", standards: ["SCIM 2.0"], summary: "SCIM provisioning/deprovisioning on Enterprise.", citations: [cite("Figma SCIM", "https://help.figma.com/")] },
      entitlements: { verdict: "partial", standards: ["SCIM groups"], summary: "Group sync supported; fine-grained roles limited.", citations: [cite("Figma roles", "https://help.figma.com/")] },
      riskSignals: { verdict: "unsupported", standards: [], summary: "No CAEP/SSF or RISC support found.", citations: [] },
      logout: { verdict: "partial", standards: [], summary: "RP-initiated logout via IdP; no back-channel SLO documented.", citations: [] },
      tokenRevocation: { verdict: "partial", standards: ["OAuth 2.0"], summary: "OAuth tokens revocable via admin; no CAE.", citations: [cite("Figma OAuth", "https://www.figma.com/developers")] },
    }),
    extended: {
      discoverability: "Consumer + enterprise tiers; easy self-signup is a shadow-IT vector.",
      onboardingRecovery: "Org admin recovery documented.",
      enterpriseDiscovery: "Available in Okta Integration Network (Enterprise).",
      usageMonitoring: "Admin audit log on Enterprise tier only.",
      usageRestrictions: "Domain capture + managed accounts on Enterprise.",
    },
    assessedAt: new Date(Date.now() - 86400e3 * 1).toISOString(),
  },
  {
    id: "a-tool", app: "QuickSign", vendor: "QuickSign LLC", category: "e-Signature (freemium)",
    score: 28, recommendation: "Reject",
    summary: "No enterprise identity controls. Local password accounts only, no SSO, no SCIM, no token revocation. High account-takeover exposure for a tool that handles signed documents.",
    recommendationRationale: "Fails every critical access control. Do not approve for any data with production exposure. Recommend a vetted alternative.",
    conditions: [],
    risks: [
      "Local password auth with no enforced MFA — prime account-takeover target.",
      "No deprovisioning: offboarded employees retain access.",
      "No audit log export for incident response.",
    ],
    ownerMap: [
      { function: "Third-Party Governance", responsibility: "Block procurement; document rejection rationale." },
      { function: "Security Architecture", responsibility: "Recommend an SSO/SCIM-capable alternative." },
    ],
    capabilities: controls({
      sso: { verdict: "unsupported", standards: [], summary: "No SAML/OIDC SSO. Local username/password only.", citations: [] },
      ulm: { verdict: "unsupported", standards: [], summary: "No SCIM; manual user management only.", citations: [] },
      entitlements: { verdict: "unsupported", standards: [], summary: "No group/role sync.", citations: [] },
      riskSignals: { verdict: "unsupported", standards: [], summary: "No risk-signal sharing.", citations: [] },
      logout: { verdict: "unknown", standards: [], summary: "No session-management documentation found.", citations: [] },
      tokenRevocation: { verdict: "unsupported", standards: [], summary: "No OAuth token revocation.", citations: [] },
    }),
    extended: {
      discoverability: "Freemium self-signup; commonly adopted as shadow IT.",
      onboardingRecovery: "Email-based password reset only.",
      enterpriseDiscovery: "Not in any IdP integration network.",
      usageMonitoring: "No audit logging.",
      usageRestrictions: "None.",
    },
    assessedAt: new Date(Date.now() - 3600e3 * 6).toISOString(),
  },
];

const now = Date.now();
export const DEMO_DISCOVERED = [
  { domain: "workday.com", name: "Workday", methods: { sso: true, social: false, password: false, federated: false, oauthGrant: false }, idps: ["yourco.okta.com"], oauth: [], sources: ["okta", "extension"], firstSeen: now - 86400e3 * 30, lastSeen: now - 3600e3 * 2, assessmentId: "a-okta", assessment: { id: "a-okta", score: 92, recommendation: "Approve" } },
  { domain: "figma.com", name: "Figma", methods: { sso: false, social: true, password: false, federated: false, oauthGrant: true }, idps: ["accounts.google.com"], oauth: [{ idp: "accounts.google.com", clientId: "figma-web", scopes: ["email", "profile", "drive.file"], ts: now - 86400e3 }], sources: ["extension"], firstSeen: now - 86400e3 * 12, lastSeen: now - 3600e3 * 5, assessmentId: "a-figma", assessment: { id: "a-figma", score: 64, recommendation: "Approve with conditions" } },
  { domain: "quicksign.io", name: "Quicksign", methods: { sso: false, social: false, password: true, federated: false, oauthGrant: false }, idps: [], oauth: [], sources: ["extension"], firstSeen: now - 86400e3 * 3, lastSeen: now - 3600e3 * 6, assessmentId: "a-tool", assessment: { id: "a-tool", score: 28, recommendation: "Reject" } },
  { domain: "notion.so", name: "Notion", methods: { sso: false, social: true, password: false, federated: false, oauthGrant: true }, idps: ["accounts.google.com"], oauth: [{ idp: "accounts.google.com", clientId: "notion", scopes: ["email", "profile"], ts: now - 86400e3 * 2 }], sources: ["extension"], firstSeen: now - 86400e3 * 9, lastSeen: now - 3600e3 * 9 },
  { domain: "airtable.com", name: "Airtable", methods: { sso: false, social: false, password: true, federated: false, oauthGrant: false }, idps: [], oauth: [], sources: ["extension"], firstSeen: now - 86400e3 * 6, lastSeen: now - 3600e3 * 20 },
  { domain: "asana.com", name: "Asana", methods: { sso: true, social: false, password: false, federated: false, oauthGrant: false }, idps: ["yourco.okta.com"], oauth: [], sources: ["okta"], firstSeen: now - 86400e3 * 20, lastSeen: now - 3600e3 * 30 },
  { domain: "chatgpt.com", name: "Chatgpt", methods: { sso: false, social: true, password: false, federated: false, oauthGrant: true }, idps: ["accounts.google.com"], oauth: [{ idp: "accounts.google.com", clientId: "openai", scopes: ["email", "profile"], ts: now - 3600e3 * 40 }], sources: ["extension"], firstSeen: now - 86400e3 * 4, lastSeen: now - 3600e3 * 3 },
  { domain: "miro.com", name: "Miro", methods: { sso: false, social: false, password: false, federated: true, oauthGrant: false }, idps: ["login.microsoftonline.com"], oauth: [], sources: ["extension"], firstSeen: now - 86400e3 * 7, lastSeen: now - 3600e3 * 50 },
];

// Synthesize a plausible assessment when the demo user runs "New Assessment".
export function demoSynthesize(input) {
  const id = "a-" + Math.random().toString(36).slice(2, 8);
  return {
    id, app: input.name, vendor: input.vendor || input.name, category: "Newly assessed",
    score: 71, recommendation: "Approve with conditions",
    summary: `Demo assessment for ${input.name}. In the live product this is researched live against the six controls with citations.`,
    recommendationRationale: "Synthesized for demo purposes. Connect the server with an Anthropic key for real research.",
    conditions: ["Enforce SSO + SCIM at onboarding.", "Confirm token revocation path."],
    risks: ["Demo data — not a real assessment."],
    ownerMap: [{ function: "Security Architecture", responsibility: "Validate controls at onboarding." }],
    capabilities: controls({
      sso: { verdict: "supported", standards: ["SAML 2.0"], summary: "SSO supported (demo).", citations: [] },
      ulm: { verdict: "supported", standards: ["SCIM 2.0"], summary: "SCIM supported (demo).", citations: [] },
      entitlements: { verdict: "partial", standards: ["SCIM groups"], summary: "Partial (demo).", citations: [] },
      riskSignals: { verdict: "unsupported", standards: [], summary: "Not found (demo).", citations: [] },
      logout: { verdict: "partial", standards: [], summary: "Partial (demo).", citations: [] },
      tokenRevocation: { verdict: "partial", standards: ["OAuth 2.0"], summary: "Partial (demo).", citations: [] },
    }),
    extended: { discoverability: "—", onboardingRecovery: "—", enterpriseDiscovery: "—", usageMonitoring: "—", usageRestrictions: "—" },
    assessedAt: new Date().toISOString(),
  };
}
