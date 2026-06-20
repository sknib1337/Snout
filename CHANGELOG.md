# Changelog

All notable changes to Trust Agent are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  signed), a Slack `/trust` slash command, a Microsoft Teams bot, and deployable handler
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

[Unreleased]: https://github.com/sknib1337/trust-agent/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/sknib1337/trust-agent/releases/tag/v1.0.0
