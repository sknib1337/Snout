# Changelog

All notable changes to Snout are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
