# Snout

Agent-driven due diligence for the **critical enterprise SaaS controls** every app
must support before it touches your identity fabric. Name a SaaS tool and the agent
researches the live web — vendor docs, trust centers, the OpenID Foundation — then
scores six controls with citations and drafts a governance verdict your sourcing,
finance, third-party risk, security architecture, and IT engineering teams can all
trust. It exists to replace the slow, committee-driven (RAPID) review with something
fast and evidence-backed.

The six controls:

| Control | Standard(s) |
|---|---|
| Single Sign-On | SAML 2.0 / OIDC |
| User Lifecycle | SCIM 2.0 (provision + deprovision) |
| Entitlements | SCIM groups / RBAC |
| Risk Signal Sharing | CAEP / Shared Signals Framework |
| Logout | RP-initiated / Single Logout |
| Token Revocation | OAuth 2.0 revocation / CAE |

The **trust score** is a transparent mean of the six control weights
(Supported 100 · Partial 55 · Unverified 25 · Not found 8) — auditable, not a black box.

---

## Architecture

```
                         ┌──────────────────────────────┐
   Slack /snout ───────► │                              │
   Teams @mention ─────► │        server (Express)      │ ──► Anthropic Messages API
   ServiceNow ─┐         │                              │     + web_search tool
   Okta ───────┼──HMAC──►│  /api/assess  → agent.ts     │ ──► vendor docs · OIDF · trust pages
   NetSuite ───┘ catalog │  /api/assessments → store.ts │
                         │  /webhooks /slack /teams      │ ──► store (JSON file → Postgres)
                         └──────────────┬───────────────┘
                                        │ REST /api
                         ┌──────────────▼───────────────┐
                         │     web (React + Vite)        │
                         │  Command Center · Assessments │
                         │  Detail · Integrations        │
                         └───────────────────────────────┘
```

- **`server/`** — Express + TypeScript. Runs the agent, persists assessments, and hosts
  the chat + catalog webhooks. The agent calls the Anthropic Messages API with the
  server-side `web_search` tool, so the API key never reaches the browser.
- **`web/`** — React + Vite, the Obsidian Command console. Talks only to `server` over REST.

Every entry point (UI, Slack, Teams, catalog webhook) funnels through the same
`assessApp()` and the same store, so a `/snout Notion` in Slack and a click in the
dashboard produce one identical record.

---

## Quickstart

Prerequisites: Node 20+.

```bash
git clone <your-fork-url> snout && cd snout
npm install                 # root tooling (concurrently)
npm run install:all         # installs server + web deps

cp server/.env.example server/.env   # add ANTHROPIC_API_KEY
cp web/.env.example web/.env

npm run dev                 # server :8787  +  web :5173 (proxied)
```

Open http://localhost:5173, type an app name in the form / the sidebar terminal /
the top search, and the agent goes to work (~20–40s).

### Docker

```bash
cp server/.env.example server/.env   # add ANTHROPIC_API_KEY
docker compose up --build            # web on :8080, server on :8787
```

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | liveness + active model |
| `GET`  | `/api/assessments` | list, newest first |
| `GET`  | `/api/assessments/:id` | one assessment |
| `POST` | `/api/assess` | `{ name, vendor?, url?, context? }` → runs agent, returns the record |
| `DELETE` | `/api/assessments/:id` | remove |
| `GET`  | `/api/catalog` | list discovered apps (enriched with any linked assessment) |
| `POST` | `/api/catalog` | bulk-ingest discovered apps `{ apps: [...] }` (used by the extension's Sync) |
| `POST` | `/api/catalog/:domain/assess` | assess a discovered app and link the result |
| `DELETE` | `/api/catalog/:domain` | remove a discovered app |
| `POST` | `/webhooks/catalog/:source` | `servicenow` \| `okta` \| `netsuite` — HMAC signed |
| `POST` | `/slack/snout` | `/snout <app>` slash command |
| `POST` | `/teams/snout` | Teams outgoing webhook / bot |

`/api/*` can be protected with a bearer token by setting `API_TOKEN`.

---

## Integrations

**Inbound catalog** — point ServiceNow Flow, an Okta Workflows job, or a NetSuite
saved search at `/webhooks/catalog/:source`, signing the body with `SNOUT_WEBHOOK_SECRET`
(`x-snout-signature: <hex hmac-sha256>`). Each record is normalized and queued for
assessment automatically.

**Slack** — create a slash command `/snout`, set its Request URL to `/slack/snout`,
and add `SLACK_SIGNING_SECRET`. The command acks instantly and posts the verdict back
to the channel when the agent finishes (via Slack's `response_url`).

**Teams** — add an Outgoing Webhook, paste its security token into `TEAMS_SECURITY_TOKEN`,
and mention `@Snout assess <app>`. Cached apps return instantly; new ones kick off
in the background. Because Teams outgoing webhooks are synchronous (~5s budget), a true
async reply needs a Bot Framework bot that stores the conversation reference and posts a
proactive message — `routes/teams.ts` marks exactly where to slot that in.

---

**Browser extension (shadow SaaS & auth discovery)** — `extension/` is a Manifest V3
Chrome extension that watches how you authenticate as you browse and catalogs shadow
SaaS and shadow auth (local passwords, consumer/social IdP logins, OAuth consent
grants) — all local-first. Each discovered app has a one-click **Assess in Snout**
button that calls `/api/assess`. Load it via `chrome://extensions → Load unpacked`. See
`extension/README.md`.

## Configuration

See `server/.env.example` and `web/.env.example`. Each webhook route returns `501` until
its secret is set, so you can enable integrations one at a time.

## Persistence

Default is a single JSON file under `DATA_DIR` — zero setup, fine for small teams. For
production, implement the `Store` interface in `server/src/store.ts` against Postgres
(one `assessments` table, JSONB `data`, unique `lower(app)` index for upsert) and swap
the export; nothing else changes.

## Demo

A self-contained, offline demo of the dashboard (seeded with illustrative data — no
server or API key needed) can be built with:

```bash
cd web && npm run build:demo   # produces web/dist/index.html — open it in a browser
```

A prebuilt `snout-demo.html` is also included at the repo root for convenience. The demo
data is illustrative only; see [DISCLAIMER.md](./DISCLAIMER.md).

## Security

This app runs an LLM over untrusted web content and exposes a compute-heavy endpoint, so it ships hardened by default. Highlights:

- **Prompt injection (OWASP LLM01):** untrusted input is fenced and labelled as data; the system prompt refuses embedded instructions; and the model's JSON is run through a strict schema that coerces verdicts, clamps lengths, and drops unsafe citation URLs. Least-privilege tooling (read-only `web_search`).
- **Auth (API2):** `/api/*` requires a bearer token; the server **fails closed in production** (won't start without `API_TOKEN` unless `ALLOW_ANON=true`).
- **Resource abuse (API4/API6):** per-client rate limits, a stricter `/assess` bucket, a concurrency cap, body-size limits, and request timeouts.
- **SSRF (API7):** all URLs (input + citations) are allowlisted to public http(s); private/loopback/metadata hosts blocked.
- **Misconfiguration (API8):** helmet + CSP + strict CORS; leak-free error handler; request ids.
- **Output handling (LLM05):** Slack/Teams text is escaped and broadcast-mentions stripped; citation links are re-validated client-side.

Full threat model, control mapping, and a deployment hardening checklist are in **[SECURITY.md](./SECURITY.md)**. Verdicts are evidence-backed research, not sign-off — a human approves.

## Tests

```bash
npm test            # server: scoring + HMAC (vitest)
```

## Roadmap ideas

- Postgres store + audit log of who approved what
- Spend signal join (NetSuite/Productiv) to flag shadow-IT you pay for but haven't assessed
- Settings: default reviewers, score thresholds, secret rotation
- Bot Framework Teams bot for true async replies

## Releases

Versioning follows SemVer; changes are recorded in [CHANGELOG.md](./CHANGELOG.md).
To cut a release: bump `extension/manifest.json` to match, add a `## [x.y.z]` changelog
entry, then tag and push:

```bash
git tag -a v1.0.0 -m "Snout v1.0.0"
git push --follow-tags
```

The `Release` workflow verifies the tag matches the manifest version, builds a
Web-Store-ready extension zip (manifest at the zip root), and publishes a GitHub Release
with that zip attached and the changelog section as notes — one click to distribute.

## Disclaimer

Snout's assessments are automated, AI-generated, and may be wrong — they are a research
aid, not professional advice or sign-off, and a human must review every decision. It
names third-party vendors for identification only and is not affiliated with them. The
browser extension's monitoring is the deployer's legal responsibility. Please read
[DISCLAIMER.md](./DISCLAIMER.md) before relying on any output.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) and our
[Code of Conduct](./CODE_OF_CONDUCT.md). Report security issues privately per
[SECURITY.md](./SECURITY.md), not via public issues.

## License

MIT — see [LICENSE](./LICENSE).
