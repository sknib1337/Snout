# Roadmap

This roadmap turns the competitive analysis into sequenced work. It is ordered by
**leverage** (impact ÷ effort), not by ease. Effort is rough: **S** ≤ 1 day, **M** a few
days, **L** 1–2 weeks.

## Positioning (the wedge we are defending)

Snout is **agentic, transparent, IPSIE-aligned identity-control due diligence for
the buy/keep decision**, triggered by shadow-auth discovery. We do *not* try to become a
runtime SSPM (AppOmni, Obsidian, CrowdStrike Falcon Shield own that) or to out-discover a
SaaS-management platform (Nudge owns email-based discovery breadth). Every item below
should make the wedge sharper — deeper identity-control vetting, better evidence, broader
*signals* feeding the vetting — not chase a category we can't win.

Two hard rules for everything that follows:
1. **Never weaken the security invariants** in `SECURITY.md` / `CLAUDE.md`.
2. **Verdicts are evidence, not sign-off** — a human always approves; keep citations and
   the transparent score intact.

---

## Now — v1.0.0 (shipped)

- Assessment agent over the six controls (SSO, lifecycle/SCIM, entitlements,
  CAEP/SSF risk signals, logout/SLO, token revocation/CAE) with web citations + score.
- Command Center dashboard, assessment catalog & detail (trust hexagon), Discovered view.
- Integrations: catalog webhooks (ServiceNow/Okta/NetSuite, HMAC), Slack `/snout`, Teams.
- Browser extension: shadow SaaS + shadow auth capture, Sync, managed config, auto-sync.
- Security hardening (OWASP LLM + API Top 10), `ENABLE_CATALOG` capability flag.

---

## Phase 1 — Discovery breadth (v1.1) · **L** · highest leverage

**Goal.** Stop being browser-only. Add IdP-log and OAuth-grant ingestion so the Discovered
inventory is complete and historical, with the extension as one sensor among several.

**Why.** Browser-only is our biggest exposure: it misses anything not authenticated
in-browser and has no history. Nudge sees more via email; Push enriches via IdP APIs. This
is the difference between "a neat extension" and "complete visibility."

**Build.**
- [ ] `server/src/sensors/` — a `Sensor` interface that normalizes findings into
      `upsertDiscovered()` (reuse `DiscoveredApp` exactly; one shared shape).
- [ ] Okta System Log connector (`/api/sensors/okta/sync`) — pull sign-in events, derive
      app + auth method (SSO vs password vs social) + OAuth grants.
- [ ] Microsoft Entra sign-in logs + Google Workspace audit connectors (same interface).
- [ ] OAuth-grant inventory via Microsoft Graph / Google token APIs (idp, client, scopes).
- [ ] Scheduled pull (cron/worker) writing into the existing discovered store.
- [ ] Source attribution already exists (`sources[]`) — populate `okta` / `entra` / `google`.

**Done when.** With the extension uninstalled, connecting Okta populates the Discovered
view with apps, auth methods, and OAuth grants, deduped against extension findings.

**Touches.** `server/src/sensors/*`, `store.ts` (no schema change needed), `routes/`,
`web` Discovered view (show `source` badges).

---

## Phase 2 — Accuracy & a data moat (v1.2) · **M** · highest leverage

**Goal.** Make verdicts trustworthy and stop re-inferring from scratch every run.

**Why.** Citations help, but LLM inference can be stale or wrong, and accuracy that
compounds over time *is* the moat (it's why Nudge touts 200k vendor profiles). Today every
assessment is a cold inference.

**Build.**
- [ ] `server/src/knowledge/` — a cached, verified store of vendor control facts
      (per vendor × control: supported/partial/no + source + verified_by + verified_at).
- [ ] Agent reads the cache first; only researches gaps; writes back proposed facts.
- [ ] Seed corpus: Okta Integration Network capabilities, vendor SSO/SCIM docs, the
      community "SSO tax" list (sso.tax) for the SSO-tier gating signal.
- [ ] Per-control **confidence** + a human **override/confirm** loop surfaced in the UI.
- [ ] `server/eval/` — a labeled benchmark set (≈30 known vendors) + a script that scores
      agent verdicts against it; wire into CI as a non-blocking report.

**Done when.** Re-assessing a known vendor returns cached, human-verified facts with a
confidence score, and the eval script prints accuracy vs the labeled set.

**Touches.** `agent.ts`, `security/schema.ts` (add confidence/verified fields), new
`knowledge/` + `eval/`, web detail view (confidence + confirm/override).

---

## Phase 3 — Continuous monitoring (v1.3) · **M**

**Goal.** Move from point-in-time to living posture.

**Why.** Vendors add SCIM, change tiers, or get breached. Nudge's supply-chain breach
alerts are table stakes.

**Build.**
- [ ] Scheduled re-assessment with change detection (diff vs prior verdict → "now supports
      CAEP" timeline event).
- [ ] Breach / CVE feed subscription per cataloged vendor → flag + notify (reuse Slack/Teams).
- [ ] "What changed" feed on the dashboard.

**Done when.** A re-run that changes a control verdict records a dated change event and
fires a notification.

**Touches.** worker/cron, `store.ts` (assessment history), `routes/slack.ts`/`teams.ts`,
web (timeline).

---

## Phase 4 — Capability → configuration bridge (v1.4) · **L**

**Goal.** Verify the controls a vendor *supports* are actually *turned on* in your tenant.

**Why.** This is the seam between us (capability vetting) and SSPM (runtime posture). A
light connector closes the loop without trying to out-feature AppOmni.

**Build.**
- [ ] Optional read-only tenant connector per app (start with the apps that matter:
      Okta/GWS/M365) that checks: is SSO enforced, is SCIM active, are sessions revocable.
- [ ] Show "supported ✓ / configured ✗" deltas on the assessment detail.

**Done when.** An assessed app shows whether each supported control is enabled in your env.

**Touches.** `server/src/connectors/`, `controls.ts` (configured-state field), web detail.

---

## Phase 5 — Action, not just a verdict (v1.5) · **M**

**Goal.** Turn a recommendation into a tracked action.

**Why.** Competitors remediate (Push enforces in-browser; SSPMs auto-remediate; Nudge
nudges owners). We stop at advice.

**Build.**
- [ ] One-click ServiceNow / Jira ticket from a verdict (exception, onboarding, or risk).
- [ ] "Nudge the app owner" via Slack/Teams using the `ownerMap` we already generate.
- [ ] Auto-draft a vendor security questionnaire from the gaps found.

**Done when.** "Approve with conditions" can open a Jira ticket pre-filled with conditions.

**Touches.** `routes/`, integrations, web detail actions.

---

## Phase 6 — Dogfood identity (v1.6) · **M**

**Goal.** Put real SSO in front of the tool that grades SSO.

**Why.** It's a tell that the dashboard is protected only by a bearer token. Fix the
security gap and get a live demo of our own thesis (target our own IPSIE SL1).

**Build.**
- [ ] OIDC login for the dashboard + session handling; bearer token becomes service-to-service only.
- [ ] RBAC (viewer / assessor / admin) and an access audit log.

**Done when.** Dashboard requires SSO; roles gate assess/delete; access is audited.

**Touches.** `server/src/security/auth.ts`, `index.ts`, `web` (auth flow).

---

## Phase 7 — OAuth-scope & AI-app risk scoring (v1.7) · **S–M**

**Goal.** Score the risk of OAuth grants and classify AI tools — the most on-trend signal.

**Why.** Push, Nudge, and Grip all lean hard into AI apps, OAuth grants, and MCP. We
*capture* OAuth grants but don't *score* them.

**Build.**
- [ ] Scope-risk model (read vs write vs admin; mail/file/dir access weighting).
- [ ] AI-app classification + an "AI tools" filter in Discovered.
- [ ] MCP-integration detection.

**Done when.** Discovered apps show an OAuth scope-risk badge; AI tools are filterable.

**Touches.** `extension/classify.js`, `server` catalog enrichment, web Discovered.

---

## Cross-cutting / platform (do alongside)

- [ ] **Postgres `Store` adapter** behind the existing interface (two tables); keep JSON for dev. **M**
- [ ] **Multi-tenant + org scoping** once Phase 6 lands. **M**
- [ ] **Pluggable input/output injection-classifier guard** in front of the agent (Llama
      Guard / a prompt-injection detector) — the stronger gate noted in `SECURITY.md`. **S**
- [ ] **GHCR image release** — extend `.github/workflows/release.yml` to build & push
      `server` and `web` images on tag, so one tag ships all three deployables. **S**
- [ ] **Observability** — structured logs + metrics on assess latency, agent token spend,
      rate-limit hits; forward `x-request-id` + `[audit]` to a SIEM. **S**

---

## Good first tasks for Claude Code (small, high-signal)

These are self-contained entry points to build momentum:
- GHCR image-release workflow (cross-cutting) — isolated, no app code.
- Eval harness + 10-vendor labeled set (Phase 2, first slice) — pure addition, no risk.
- OAuth scope-risk badge in the Discovered view (Phase 7 slice) — front-of-stack only.
- Postgres `Store` adapter (cross-cutting) — implements an existing interface; tests already
  exercise the contract (`server/test/store.test.ts`).

When starting any item: read `CLAUDE.md` first, run `npm run typecheck && npm test` in
`server/` before and after, and keep `web` building. Update `CHANGELOG.md` under
`[Unreleased]` and tag a release per the README when a phase lands.
