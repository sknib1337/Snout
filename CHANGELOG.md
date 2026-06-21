# Changelog

All notable changes to Snout are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
