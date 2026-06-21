# Contributing to Snout

Thanks for your interest in improving Snout! This guide covers how to set up, what we
expect in a pull request, and how contributions are licensed.

## Development setup

Prerequisites: Node 20+.

```bash
git clone https://github.com/sknib1337/Snout snout && cd snout
npm install            # root tooling
npm run install:all    # installs server + web deps
cp server/.env.example server/.env   # add ANTHROPIC_API_KEY
cp web/.env.example web/.env
npm run dev            # server :8787 + web :5173
```

The browser extension loads via `chrome://extensions → Load unpacked → extension/`.

## Before you open a pull request

- `npm test` passes (server typecheck + unit tests).
- `npm run build` succeeds for both `server` and `web`.
- Add or update tests when you change behavior, especially for anything in
  `server/src/security/` or `server/src/store.ts`.
- Add a short entry under `## [Unreleased]` in `CHANGELOG.md`.
- Keep changes focused; smaller PRs are reviewed faster.

## Security-sensitive changes

Snout runs an LLM over untrusted content and exposes a network API. Please don't weaken
the controls documented in [SECURITY.md](./SECURITY.md) — input fencing, output
validation, fail-closed auth, rate limits, and URL allow-listing. If your change touches
any of these, call it out explicitly in the PR description.

**Found a vulnerability?** Do not open a public issue. Report it privately as described
in [SECURITY.md](./SECURITY.md).

## Coding conventions

- Server is TypeScript (CommonJS output); tests use vitest; validation uses zod.
- Match the existing style; keep dependencies minimal.
- Document non-obvious decisions in code comments rather than commit messages.

## Licensing of contributions

Snout is licensed under the [MIT License](./LICENSE). **By submitting a contribution, you
agree that your contribution is licensed under the MIT License (inbound = outbound), and
you represent that you have the right to submit it** under those terms. Please don't
submit code, text, or data you don't have the right to license this way.

We use the [Developer Certificate of Origin](https://developercertificate.org/). Sign off
your commits to certify you can contribute the work:

```bash
git commit -s -m "your message"
```

This appends a `Signed-off-by: Your Name <you@example.com>` line to the commit.

## Code of conduct

Participation in this project is governed by our
[Code of Conduct](./CODE_OF_CONDUCT.md). Please read it.
