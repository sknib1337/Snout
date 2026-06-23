# Snout knowledge base

This directory is Snout's **open, verified knowledge base** of IPSIE-aligned identity-control
support per SaaS vendor. It's what makes assessments compound and get *more accurate over time*:
the agent reads human-verified facts here first and researches only the gaps, and the eval
harness measures predictions against a labeled benchmark.

## How it's used

- One JSON file per vendor, named `<domain>.json` (e.g. `slack.com.json`), conforming to
  [`schema.json`](./schema.json).
- At runtime Snout merges these files with live human verifications stored via the dashboard /
  `POST /api/kb/:key/:control`. Merge precedence per control: a **human-verified** fact wins
  (either layer), else the live override, else the repo file.
- **Only `source: "human"` facts are injected into the agent as trusted priors.** `seed` and
  `agent` facts are candidates for review — they show up for verification but are never treated
  as ground truth by the agent.

## Contributing a fact

1. Add or edit `kb/<domain>.json` (copy an existing file as a template).
2. Cite real first-party or well-known sources (vendor docs, [sso.tax](https://sso.tax/), the
   Okta Integration Network, the OpenID Foundation). No citation → keep `confidence` low.
3. Use `source: "seed"` for community facts you haven't formally verified; maintainers promote
   well-evidenced facts to `source: "human"`.
4. Run `npm run kb:validate` (in `server/`) — CI validates every file against the schema.

Check coverage and the human-verified ratio with `npm run kb:stats`, and measure accuracy with
`npm run eval -- --baseline` (reports held-out accuracy + a baseline comparison). See
[server/eval/README.md](../server/eval/README.md) for the label-independence rules — in
particular, **held-out benchmark vendors must never get a `kb/<domain>.json` file**, or they stop
being a generalization test (the seeder enforces this and skips them).

## Control keys

`sso` · `ulm` (user lifecycle / SCIM) · `entitlements` · `riskSignals` (CAEP/SSF) · `logout` ·
`tokenRevocation`. Verdicts: `supported` · `partial` · `unsupported` · `unknown`.

> Facts are evidence-backed research, not vendor certification. See the repo
> [DISCLAIMER.md](../DISCLAIMER.md).
