# Eval harness

Measures Snout's per-control verdict quality against a labeled benchmark — honestly.

```bash
npm run eval                    # KB-only, deterministic (no LLM); writes kb/EVAL.md + appends kb/EVAL-history.jsonl
npm run eval -- --baseline      # add the baseline comparison (naive floor vs KB-only); still deterministic
npm run eval -- --live          # run the real assessment agent (KB-augmented); uses your provider, costs tokens
npm run eval -- --live --baseline  # also runs the no-KB model -> reports KB LIFT (the moat's measured value)
```

## What it reports

- **Accuracy** and **coverage** (share of controls with a non-`unknown` prediction).
- **Held-out (never-in-KB) accuracy** — the same metric computed over only the vendors with no
  `kb/` file (`inKb: false`). This is the **generalization number**: how well predictions hold up
  on vendors we haven't hand-curated. It is the honest headline, not the in-KB accuracy.
- **Baseline comparison** (`--baseline`) — accuracy of each predictor on the same cases:
  - `naive (always-unknown)` — the floor; anything that can't beat it adds nothing.
  - `KB-only (deterministic)` — the curated KB, no LLM.
  - `no-KB LLM` / `KB-augmented LLM` (`--live`) — the model without and with the KB.
- **KB lift** (`--live --baseline`) — `KB-augmented − no-KB` accuracy. This is the **measured value
  of the KB**: if it's near zero, the KB isn't earning its keep; if held-out lift is positive, the
  curation generalizes. Reporting this is the whole point — the thesis ("better on the identity
  axis") must be a number, not a slogan.
- **Per-verdict precision / recall** and a **confusion matrix** — where predictions are wrong vs
  merely silent.
- **Confidence calibration** — does predicted confidence track actual accuracy?
- **Trend** — each run appends to `kb/EVAL-history.jsonl` (now including `heldOutAccuracy` and
  `kbLift` when available) and the last runs show in `kb/EVAL.md`.

## Label discipline (the important part)

The benchmark in `benchmark.json` is the **ground truth**. For the accuracy number to mean
anything, labels must be maintained **independently of the KB** — otherwise the KB is graded
against itself. The protocol:

1. **Independent source.** Each case's `source` must cite where the *label* came from, drawn from a
   source set **disjoint** from the KB file's sources where possible (e.g. label held-out vendors
   from vendor docs / IdP provisioning tutorials, not the same sso.tax pass used to seed the KB).
   Prefer a *different maintainer or a different pass* than the KB file.
2. **Hold out, don't just cover.** Tag every case `inKb: true | false`. `false` vendors must have
   **no** `kb/<domain>.json` — they are the generalization test and are never curated to match.
   Grow the held-out set over time; it is the bias-resistant signal.
3. **Keep deliberate probes:**
   - **Coverage-gap probes** — held-out vendors (Calendly, Airtable, Box, Zendesk, Miro,
     1Password). KB-only predicts `unknown` for these by construction.
   - **Drift probes** — a label set to the *correct* value where the KB seed is stale/wrong
     (e.g. HubSpot `ulm`). Verifies the eval catches KB errors, not just gaps.
4. **Label conservatively.** When a control (e.g. CAEP/SSF risk signals, SLO, CAE) isn't clearly
   documented, the honest label is `unknown` — do not infer support from vendor reputation.

Treat **held-out accuracy, KB lift, coverage, the confusion matrix, and calibration** as the
trustworthy signals — not the in-KB headline accuracy (which can be optimistic when labels and KB
share sources).

## CI gate

`server/test/kb.test.ts` runs the KB-only eval deterministically and fails if accuracy drops
below the floor or the depth metrics go missing — so a KB change that regresses quality is caught
in CI.
