# Changelog

All notable changes to Snout are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Console v2 design pass** (EPIC-CONSOLE-V2). The dashboard and extension popup now share one
  design-token source (`tokens.css`, `--sn-*`, WCAG-checked: `#8c909f` demoted to borders-only,
  unknown-verdict color moved to an AA-passing `#9aa3bd`). A **de-robotization** pass makes all
  chrome Inter sentence case with JetBrains Mono reserved for data — verdict/governance/band pills
  keep mono caps with **glyph + label + color** (never color alone) — and provenance is quiet text.
  The **Command Center** gains a hero metric, a vendors×controls **coverage matrix** (with a live
  weakest-control note), a **needs-attention queue**, and a live system panel; the sidebar gains a
  **portfolio pulse** bar and an **engine feed** of real events (assessments, KB verifies,
  discovery) plus a measured once-a-minute heartbeat — no fabricated telemetry. An accessible
  **toast system** replaces every native `alert()` (auto-dismiss with pausable progress,
  `aria-live`, ESC, reduced-motion), status banners follow the v2 recipes (including a new
  reduced-grounding banner), the radar gets verdict-colored dots + weight labels, and the new
  brand mark/wordmark, favicons, and OG metadata land across web + extension (which also bundles
  its fonts locally and is renamed "Snout — Shadow SaaS & Auth Discovery"). A top-level **React error boundary** replaces white-screens
  with a friendly, reload-able fallback; a **Vitest + Testing Library** smoke suite covers the
  dashboard shell, the readiness/setup states, demo mode, and the boundary (the web tier had no
  tests before). Repo-wide **ESLint** (flat config — typescript-eslint for the server,
  react-hooks for the web, webextension globals for the extension) runs in CI alongside the new
  web test job, and CI pins **Node 20.19**.
- **First-run activation** (EPIC-ACTIVATION). The dashboard now reflects **honest readiness**: an
  `/api/config` `readiness` block + a `/health` `assessReady` flag drive a real status badge
  (Connecting… / Backend offline / Setup needed / Reduced grounding / System Healthy) instead of a
  hardcoded "System Healthy", with a setup banner naming the exact env var to set.
  `POST /api/assess` now **fails fast** with a clear `provider_not_configured` message (no doomed
  LLM call) when no key is configured. A runtime **Load sample data** demo mode — also reachable via
  a shareable `?demo=1` link — lets anyone explore the full dashboard offline with no key (*Run
  assessment* synthesizes locally; an Exit-demo control returns to live state). Readiness exposes
  booleans only, never secret values.
- **Verified core + KB verification meter** (EPIC-MOAT Sprint 2). `npm run kb:stats` plus a
  dashboard verified-% bar (queue prioritized most-unverified-first, per-vendor bulk verify) make
  "human-verified and compounding" measurable; the eval adds a **KB-verified-only** comparison row
  so verification's effect on accuracy is visible. The top-tier vendors (Slack, GitHub, Salesforce)
  are hand-authored to `human`-verified against first-party docs (with specific citations), and the
  seeder **skips held-out benchmark vendors** so it can't inflate the eval.
- **Bias-resistant eval** (EPIC-MOAT Sprint 1). The eval breaks the label↔KB circularity:
  benchmark cases are tagged `inKb`, the report leads with **held-out (never-in-KB) accuracy**, and
  a `--baseline` mode compares a naive floor, KB-only, and (with `--live`) the model **with and
  without** the KB — reporting the **KB lift**. Independent held-out vendors (Box, Zendesk, Miro,
  1Password) were added; the label-independence protocol is documented in `server/eval/README.md`.
- **Postgres store + per-tenant data isolation** (`server/src/store.pg.ts`, `pg`). Set
  `DATABASE_URL` to switch from the zero-config JSON store (single-tenant) to a Postgres
  backend that scopes **every** row by tenant — each query carries `WHERE tenant = $1`, so one
  tenant can never read or write another's data (closing the prior "looks multi-tenant, isn't"
  gap where `TENANT_ID` was only an audit tag). A `withTenant` middleware carries the request
  tenant via `AsyncLocalStorage` so the store facade scopes calls without threading a parameter
  everywhere; the JSON store is unchanged and remains the default. Schema auto-creates on first
  use; `server/db/schema.sql` ships as reference (+ optional row-level-security notes).
- **OIDC dashboard login** (`server/src/oidc.ts`, `server/src/routes/auth.ts`, `openid-client` +
  `jose`). When fully configured (`OIDC_ISSUER` + client id/secret + redirect URI +
  `SESSION_SECRET`), users sign in via your IdP (Authorization Code + PKCE, state, nonce) and a
  signed, httpOnly session cookie authorizes API calls. Bearer tokens still work alongside it.
  Only ID-token claims are used for identity — no IdP tokens are stored. Role maps from a
  configurable claim (`OIDC_ADMIN_VALUE`); the session tenant is authoritative (a user can't
  escape it via `x-tenant`). The dashboard shows a sign-in gate and a sign-out control.
- **Google Workspace IdP poller** (`server/src/pollers.ts`, `jose`). Completes the poller trio:
  signs a service-account JWT (RS256) impersonating an admin via domain-wide delegation,
  exchanges it for a read-only Reports scope token, and pulls login + OAuth-grant activity from
  the Admin SDK Reports API into the existing `google` adapter. Off unless the SA credentials +
  admin subject are set; outbound only to Google's fixed hosts; the key is never logged.
- **IdP pull-pollers** (`server/src/pollers.ts`, depth D4). Optional zero-touch discovery:
  Snout periodically pulls Okta System Log (`OKTA_LOG_URL` + SSWS `OKTA_API_TOKEN`) and Microsoft
  Entra sign-ins (`ENTRA_TENANT_ID`/`ENTRA_CLIENT_ID`/`ENTRA_CLIENT_SECRET`) via native fetch
  and feeds them through the same adapters as the push webhooks. Off unless
  `IDP_POLL_INTERVAL_MINUTES` is set; outbound only to your IdP; `OKTA_LOG_URL` is validated at
  startup; credentials are never logged.
- **Supporting depth (D4/D5).** Multi-sensor discovery now reduces hosts to the **registrable
  domain** (eTLD+1, heuristic public-suffix set — no new dependency) so sensors dedupe correctly.
  Optional **scheduled re-assessment** (`REASSESS_INTERVAL_HOURS`) re-runs stale assessments and
  fires regression alerts, making monitoring continuous. OAuth scope risk in posture is now
  **tiered** (write/admin = high, broad read = medium, offline = low).
- **KB compounding loop** (`server/scripts/seed-kb.ts`, `GET /api/kb`, dashboard **Knowledge**
  view). `npm run seed:kb` batch-runs the agent over a vendor list to generate unverified
  proposals at scale; the Knowledge view is a verification queue where a human promotes
  proposals to verified and sees freshness (facts older than 180 days flagged stale).
- **Assessment-correctness passes** (`server/src/verify.ts`, `server/src/citations.ts`), both
  off by default. `VERIFY_FINDINGS=true` runs an adversarial **refutation pass** that
  deterministically demotes verdicts it can't defend to `unknown` (never demoting human-verified
  KB facts, never upgrading). `CHECK_CITATIONS=true` fetches cited pages — SSRF-guarded
  (`safeUrl()` + `redirect: manual` + timeout + size cap) — and drops citations that don't
  support the control (unfetchable pages are kept).
- **Auth-posture findings** (`server/src/posture.ts`). Each discovered app is scored for
  identity risk (no corporate SSO, local-password login, consumer IdP, broad/long-lived OAuth
  scopes) with a risk score + badges in the Discovered view; `GET /api/catalog/export` emits a
  flat posture feed for SIEM/BI. Findings only — not inline enforcement.
- **Continuous monitoring** (`server/src/routes/alerts.ts`). A `POST /webhooks/breach` HMAC feed
  ingests SaaS breach/CVE items, and re-assessments raise an **alert on any control regression**;
  alerts surface in the dashboard and at `GET /api/alerts`.
- **RBAC + audit log + tenant tag** (`server/src/security/auth.ts`). The admin `API_TOKEN` can
  mutate; an optional read-only `API_VIEWER_TOKEN` is GET-only (`writeGuard`). Every mutating call
  is recorded to an append-only audit log (`GET /api/audit`, admin only) tagged with role and
  `TENANT_ID`. Per-tenant data isolation remains a Postgres-Store concern.
- **Open IPSIE-control knowledge base + measured accuracy** (`server/src/kb.ts`, `kb/`,
  `server/eval/`). Per-vendor control facts live in community-contributable `kb/<domain>.json`
  files (validated by `npm run kb:validate`) plus runtime human verify/override via
  `POST /api/kb/:key/:control`. The agent now reads **human-verified** facts first as trusted
  structured priors, researches only the gaps, and returns a per-control **confidence**;
  verified facts are authoritative and reused across assessments. Each control carries
  provenance (`kb-verified` · `agent` · `kb-proposed`), surfaced in the dashboard with an
  inline verify control; agent findings are stored as unverified proposals so the KB compounds.
  A labeled benchmark + eval harness (`npm run eval`, `kb/EVAL.md`) measures accuracy
  deterministically (KB-only) with an opt-in `--live` mode — accuracy is measured, not asserted.
- **Multi-sensor discovery** (`server/src/discovery.ts`). Inventory apps + auth methods
  without the browser extension by forwarding telemetry to two new HMAC-signed webhooks:
  `POST /webhooks/idp/:source` (`okta` | `entra` | `google` sign-in/audit logs) and
  `POST /webhooks/email` (forwarded signup/account email metadata). All sensors — extension,
  IdP logs, email — merge by domain into one discovered record, now with a **capped per-app
  history** (`events[]`) shown in the Discovered view. Push-only: no IdP/mailbox credentials
  are stored and no outbound calls are made to ingest. Events without a resolvable app domain
  are skipped and counted. Gated by `ENABLE_CATALOG`; reuses `SNOUT_WEBHOOK_SECRET`.
- **Configurable LLM provider** (`server/src/llm/`). `LLM_PROVIDER=anthropic` (default)
  keeps the Anthropic Messages API with `web_search`; `ANTHROPIC_BASE_URL` lets it run
  through a proxy / API gateway / internal Anthropic-compatible endpoint. `LLM_PROVIDER=openai`
  targets any OpenAI-compatible `/v1/chat/completions` endpoint via `LLM_BASE_URL`,
  `LLM_API_KEY`, `LLM_MODEL` (OpenAI, LiteLLM, OpenRouter, vLLM, Ollama). Existing setups
  are unchanged — `ANTHROPIC_API_KEY` alone behaves exactly as before. `/health` and
  `/api/config` now report the effective provider/model.

### Changed
- **Dependency majors, validated.** Upgraded **express 4 → 5** (+ `@types/express` 5),
  **TypeScript 5 → 6** (with tsconfig `ignoreDeprecations: "6.0"` for the deprecated `node10`
  module resolution), and **Tailwind CSS 3 → 4** (PostCSS plugin moved to `@tailwindcss/postcss`,
  `@tailwind` directives → `@import "tailwindcss"`, a v3 border-color compatibility shim, JS config
  dropped in favor of v4 auto-detection). Each was validated against the full test suite + build
  before merge; no behavior change.
- **Smaller initial web chunks.** The production build now vendor-splits `recharts` (~273 kB)
  and React (~179 kB) into their own cacheable chunks via Rolldown `advancedChunks`, so no
  single chunk exceeds Vite's 500 kB advisory (app chunk is ~70 kB). The single-file demo build
  is unchanged (one inlined `index.html`).
- **Repositioned around IPSIE.** README and dashboard copy now frame the product as *open,
  transparent, IPSIE-aligned identity-trust scoring* — the six controls are mapped to the
  OpenID Foundation's IPSIE (Interoperability Profile for Secure Identity in the Enterprise)
  control areas. Wording only; the controls, weights, and scoring are unchanged.
- Upgraded core dependencies to current majors: **zod 3 → 4** (server; `z.record` now
  takes an explicit key schema) and **React 18 → 19** (web). No behavior changes.

### Docs
- Added **[METHODOLOGY.md](./METHODOLOGY.md)** — the public, reproducible specification of the
  transparent-mean score, verdict weights, IPSIE-aligned control mapping, readiness bands, and
  grounding modes.
- Added a **Scope — what Snout is, and isn't** section to the README stating the product
  boundary: Snout *sees and reports* identity-control posture and complements your ITDR/SSPM
  and IdP; it is **not** an inline enforcer.
- Rebranded the product from "Trust Agent" to **Snout**. Renamed packages, the
  extension, the `/snout` Slack/Teams command, the `SNOUT_WEBHOOK_SECRET` env var, and
  the extension `snoutUrl`/`snoutToken` settings. No functional changes.

### Security
- Providers without live web search run with **reduced grounding**: Snout deterministically
  drops citations and downgrades unproven `supported`/`partial` verdicts to `unknown`
  (recommendation capped at `Hold`), recorded as each assessment's `grounding` mode.
  `validateAgentOutput()` runs on every provider's output and cannot be bypassed.
- Operator base URLs (`ANTHROPIC_BASE_URL` / `LLM_BASE_URL`) are trusted config validated
  for scheme + credentials (`safeBaseUrl()`) and fail closed at startup; `safeUrl()` stays
  strict (private-host block intact) for untrusted user/citation URLs. Provider error bodies
  are logged server-side only and never returned to clients; keys/base URLs are never logged.

## [1.0.0] - 2026-06-20

### Added
- **Assessment agent** — researches any SaaS app against the six critical enterprise
  SaaS controls (SSO, lifecycle, entitlements, risk signals, logout, token revocation),
  with live web citations, a transparent trust score, and a RAPID-replacing governance
  packet (recommendation, conditions, residual risks, stakeholder ownership).
- **Command Center dashboard** (Obsidian Command immersive UI) — portfolio KPIs, recent
  assessments, a needs-attention feed, searchable assessment catalog, and a detail view
  with the trust hexagon, per-control evidence, and operational due diligence.
- **Integrations** — inbound catalog webhooks for ServiceNow / Okta / NetSuite (HMAC
  signed), a Slack `/snout` slash command, a Microsoft Teams bot, and deployable handler
  snippets in-app.
- **Shadow discovery** — `/api/catalog` bulk ingest, a **Discovered** dashboard view, and
  one-click assess-and-link from a discovered app.
- **Browser extension** (Manifest V3) — captures shadow SaaS and shadow auth (corporate
  SSO vs social/consumer IdP vs local password vs OAuth grants) locally, with one-click
  Assess, bulk Sync, Chrome Enterprise managed configuration (zero-touch), and optional
  background auto-sync.
- **`ENABLE_CATALOG`** capability flag — ship the product with or without shadow
  discovery from one build (hides the Discovered view and unmounts the catalog routes).

### Security
- Prompt-injection defenses (OWASP LLM01): untrusted input is fenced and labelled as
  data, a hardened system prompt refuses embedded instructions, and the model's JSON is
  deterministically validated — verdicts coerced to a known enum, lengths/arrays clamped,
  and citation URLs allow-listed. Least-privilege read-only `web_search`.
- Fail-closed bearer auth (required in production), per-client and per-flow rate limits,
  a concurrency cap on the assess flow, SSRF URL allow-listing, helmet + CSP + strict
  CORS, a leak-free error handler with request ids, and per-assessment audit logging.
  Full threat model and control mapping in [SECURITY.md](./SECURITY.md).

[Unreleased]: https://github.com/sknib1337/snout/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/sknib1337/snout/releases/tag/v1.0.0
