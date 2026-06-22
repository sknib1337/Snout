# Eval harness

Measures Snout's per-control verdict quality against a labeled benchmark — honestly.

```bash
npm run eval            # KB-only, deterministic (no LLM); writes kb/EVAL.md + appends kb/EVAL-history.jsonl
npm run eval -- --live  # run the real assessment agent instead (uses your provider; costs tokens)
```

## What it reports

- **Accuracy** and **coverage** (share of controls with a non-`unknown` prediction).
- **Per-verdict precision / recall** and a **confusion matrix** — so you see *where* the KB is
  wrong (e.g. calling `partial` things that are `supported`) vs merely silent.
- **Confidence calibration** — does predicted confidence track actual accuracy? Well-calibrated
  means per-bucket accuracy ≈ average confidence.
- **Trend** — each run is appended to `kb/EVAL-history.jsonl` and the last runs are shown in
  `kb/EVAL.md`, so "more accurate over time" is shown, not asserted.

## Label discipline (the important part)

The benchmark in `benchmark.json` is the **ground truth**. For the accuracy number to mean
anything, labels must be maintained **independently of the KB seeds** — otherwise the KB is
graded against itself.

- Each case carries a `source` citing where the label came from. Cite first-party docs /
  [sso.tax](https://sso.tax/) — ideally a *different pass/maintainer* than the KB file.
- Keep deliberate probes so the number stays real:
  - **Coverage-gap probes** — vendors with **no** `kb/<domain>.json` (e.g. Calendly, Airtable).
    The KB predicts `unknown` for these; they measure how much is still uncovered.
  - **Drift probes** — a label intentionally set to the *correct* value where the KB seed is
    stale/wrong (e.g. HubSpot `ulm`). These verify the eval catches KB errors, not just gaps.

Until labels are fully independent, treat **coverage, the confusion matrix, calibration, and the
probe vendors** as the trustworthy signal — not the headline accuracy.

## CI gate

`server/test/kb.test.ts` runs the KB-only eval deterministically and fails if accuracy drops
below the floor or the depth metrics go missing — so a KB change that regresses quality is caught
in CI.
