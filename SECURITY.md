# Security

Snout runs an LLM that ingests **untrusted user input and untrusted web-search
results**, and exposes a paid, compute-heavy endpoint. This document records the threat
model and the controls implemented against it. Controls are mapped to the
[OWASP Top 10 for LLM Applications (2025)](https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/)
and the [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/editions/2023/en/0x11-t10/).

## Threat model

| Asset | Threat | Primary actor |
|---|---|---|
| The agent's reasoning | Prompt injection — a malicious vendor page, search result, app name, or context tries to override instructions, fake "supported" verdicts, or inject links | Anyone who controls a web page the agent might read |
| Rendered/chat output | Link & mention injection, XSS via citation URLs | Same |
| `/api/assess` | Cost abuse / DoS via floods of expensive LLM calls | Unauthenticated internet |
| The API generally | Anonymous access, data exfiltration, enumeration | Unauthenticated internet |
| Webhooks | Forged catalog/chat events triggering assessments | Anyone who finds the URL |
| Server-side fetches | SSRF to internal services / cloud metadata | Via attacker-supplied URLs |
| Secrets | Anthropic key / webhook secrets leaking | Logs, error responses, client |

## Controls

### Prompt injection (LLM01) — defense in depth
The model can't separate instructions from data, so we don't rely on it to.
- **Segregate untrusted content.** All user fields are sanitized and wrapped in an explicit `<<UNTRUSTED_INPUT>>` fence; the system prompt states that those fields *and all web-search results* are data, never instructions (`agent.ts`).
- **Constrain behavior.** A high-priority security preamble tells the model to refuse embedded instructions, never change output format, never reveal the prompt, and mark `unknown` rather than trust an unverified claim.
- **Deterministic output validation** (`security/schema.ts`) is the load-bearing control: the model's JSON is parsed through a strict zod schema that coerces verdicts to a known enum, clamps every string and array length, and **drops any citation whose URL isn't a safe public http(s) link**. A successful injection still can't emit arbitrary or oversized content.
- **Least-privilege tooling.** The only tool is read-only `web_search`, capped at 6 uses. The agent cannot act on any internal system; its output is data that a human approves.
- **Telemetry.** Injection-like input is logged (not blocked, to avoid false positives on real app names).

### Output handling (LLM05) & chat safety
- React escapes all rendered text; the only `dangerouslySetInnerHTML` is a static CSS string.
- Citation links are re-validated client-side and rendered `rel="noopener noreferrer nofollow"`.
- Text sent to Slack/Teams runs through `forChat()` — escapes `& < >`, strips `@channel/@here/@everyone` — preventing link and broadcast-mention injection.

### Authentication (API2) — fail closed
- `/api/*` requires `Authorization: Bearer <API_TOKEN>` when a token is set; comparison is constant-time.
- In **production the server refuses to start** without `API_TOKEN` unless `ALLOW_ANON=true` is explicitly set (for deployments behind an authenticating gateway). No anonymous access by default.

### Resource consumption & sensitive flows (API4/API6, LLM10)
- Per-client rate limits (keyed by token hash or proxy-aware IP): a general `/api` bucket and a **stricter `/assess` bucket**, plus a separate webhook bucket.
- A **concurrency semaphore** caps simultaneous in-flight agent runs (`429` when exhausted).
- Request bodies capped (`BODY_LIMIT`, default 64 kB); agent calls have a 90 s timeout and a bounded `max_tokens`.

### SSRF (API7)
- Every URL — the user-supplied one and every agent citation — passes `safeUrl()`: http(s) only, no embedded credentials, and **private / loopback / link-local / cloud-metadata (169.254.169.254) hosts blocked**. The server does not fetch user URLs today; this hardens the citation surface and pre-empts adding `web_fetch`.

### Security misconfiguration (API8)
- `helmet` security headers on the API; `x-powered-by` disabled; strict CORS allowlist (`WEB_ORIGIN`).
- A Content-Security-Policy plus `X-Frame-Options`, `nosniff`, `Referrer-Policy`, and `Permissions-Policy` on the web tier (`web/nginx.conf`).
- Central error handler returns generic errors with a request id — never stack traces or internals. Every response carries `x-request-id`.

### Secrets & supply chain
- Secrets live only in env / a secrets manager; `.env` is gitignored; secrets are never logged or returned.
- Lockfiles are committed; CI runs `npm audit`; Dependabot keeps dependencies current.

## Deployment hardening checklist

- [ ] `NODE_ENV=production` and a strong, rotated `API_TOKEN` (or a real auth gateway + `ALLOW_ANON=true`)
- [ ] TLS terminated in front; HSTS enabled at the edge
- [ ] `TRUST_PROXY` set to your proxy/ingress so rate-limit keys use real client IPs
- [ ] `WEB_ORIGIN` restricted to your actual front-end origin(s)
- [ ] Webhook secrets set; catalog API tokens (Okta SSWS, ServiceNow, NetSuite) scoped read-only
- [ ] Tune `RATE_LIMIT_MAX`, `ASSESS_RATE_MAX`, `MAX_CONCURRENT_ASSESSMENTS` to budget/quotas
- [ ] Swap the JSON store for Postgres; back up `DATA_DIR`/DB
- [ ] Forward `x-request-id` and the `[audit]` log lines to your SIEM

## Residual risks (by design)

- Prompt injection cannot be fully eliminated — it's a property of LLMs. Verdicts are **evidence-backed research, not sign-off**; a human approves, and the auditable score + citations exist precisely so a reviewer can catch a manipulated result.
- The default JSON store is single-node, last-write-wins.
- Teams outgoing webhooks are synchronous (~5 s); long assessments return "started" rather than a final card (see README).

## Reporting a vulnerability

Please open a private security advisory or email the maintainers rather than filing a public issue. We aim to acknowledge within 3 business days.
