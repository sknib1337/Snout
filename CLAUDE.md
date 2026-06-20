# CLAUDE.md

Context for working on Trust Agent in Claude Code. Read this before making changes.

## What this is

Agent-driven due diligence for SaaS identity controls. It assesses any SaaS app against
six controls (SSO, lifecycle/SCIM, entitlements, CAEP/SSF risk signals, logout/SLO, token
revocation/CAE), produces a transparent score + citations + a governance recommendation,
and discovers shadow SaaS / shadow auth via a browser extension. See `ROADMAP.md` for
where it's going and `SECURITY.md` for the threat model.

## Repo layout (one product, three deployables)

- `server/` — Express + TypeScript API. The agent, the JSON store, webhooks, catalog ingest.
- `web/` — Vite + React dashboard (single big `src/App.jsx`, data layer in `src/api.js`).
- `extension/` — Manifest V3 Chrome extension (plain JS; `classify.js` is shared ES module
  logic for the service worker and popup; `content.js` is a plain content script).

## Build / test / run

```bash
# server
cd server && npm install
npm run dev          # tsx watch on :8787
npm run typecheck    # tsc --noEmit  — MUST pass
npm test             # vitest        — MUST pass
npm run build

# web
cd web && npm install
npm run dev          # :5173
npm run build        # MUST stay green (the recharts >500kB chunk warning is benign)
```

Before and after any change: `cd server && npm run typecheck && npm test`, and keep
`web` building. The extension has no build — validate JS with `node --check` (module files
checked as `.mjs`) and JSON with a parse.

## Where things live

- Controls model + scoring + `Assessment`/`DiscoveredApp` types: `server/src/controls.ts`.
  Scoring is a transparent weighted mean — keep it explainable.
- The agent (prompt + API call + output handling): `server/src/agent.ts`.
- Output validation / clamping / enum coercion: `server/src/security/schema.ts`.
- Sanitizers, SSRF URL allowlist, chat-escaping, injection heuristic: `server/src/security/sanitize.ts`.
- Auth, rate limits, errors: `server/src/security/{auth,limits,errors}.ts`.
- Persistence (swap-for-Postgres seam): `server/src/store.ts` (`Store` interface).
- Extension ↔ server contract: extension `syncCatalog` payload ⇄ server `POST /api/catalog`
  (`routes/catalog.ts`, validated by the `IncomingApp` zod schema). **Keep these in sync.**

## Invariants — do NOT regress these

Security (all grounded in OWASP LLM + API Top 10; details in `SECURITY.md`):
- Untrusted input (user fields **and** web-search results) stays fenced and labelled as
  data in the agent prompt. Never let it become instructions.
- All agent output passes `validateAgentOutput()` — verdicts coerced to the enum, lengths
  and arrays clamped, citation URLs run through `safeUrl()`. Never render/store raw model output.
- `safeUrl()` blocks non-http(s), credentials, and private/loopback/metadata hosts. Apply
  it to any new URL surface.
- Auth fails closed: production refuses to start without `API_TOKEN` unless `ALLOW_ANON=true`.
- Keep per-client + per-flow rate limits and the assess concurrency cap on any new
  expensive/LLM-backed route.
- Chat output (Slack/Teams) goes through `forChat()`.

Product:
- Verdicts are evidence, not sign-off — preserve citations, the transparent score, and the
  human approval step.
- `ENABLE_CATALOG=false` must cleanly hide the Discovered view and unmount catalog routes.
- The extension is local-first and auth-triggered; don't broaden it into general browsing
  surveillance.

## Conventions

- TypeScript compiles to CommonJS; tests are vitest; validation is zod.
- Add a test when you add a security utility or a store method (see `server/test/`).
- Keep prose docs prose; keep the dashboard's Obsidian Command styling tokens (`C.*`).
- Update `CHANGELOG.md` under `[Unreleased]`; cut releases by bumping
  `extension/manifest.json`, tagging `vX.Y.Z`, and `git push --follow-tags` (the Release
  workflow builds the extension zip).
