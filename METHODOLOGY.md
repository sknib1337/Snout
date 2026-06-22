# Scoring methodology

Snout's trust score is deliberately simple and **fully auditable** — no weights are hidden,
no model decides the number. This document is the public specification of how a score and a
verdict are produced, so anyone can reproduce or contest a result.

> The reference implementation is [`server/src/controls.ts`](./server/src/controls.ts)
> (`computeScore`, `VERDICT_WEIGHT`, `CONTROLS`). The web UI mirrors it in
> [`web/src/App.jsx`](./web/src/App.jsx) for client-side display. If this document and the
> code ever disagree, the code is authoritative — please open an issue.

## The control set (IPSIE-aligned)

Snout assesses six enterprise identity-interoperability controls. They are aligned with the
control areas of the OpenID Foundation's **IPSIE** (Interoperability Profile for Secure
Identity in the Enterprise) working group — the emerging standard for how SaaS apps must
interoperate with an enterprise identity fabric. Each control is anchored to the concrete
open standard(s) that satisfy it:

| Control | Key | Standard(s) | IPSIE area |
|---|---|---|---|
| Single Sign-On | `sso` | SAML 2.0 / OIDC | Federated authentication |
| User Lifecycle | `ulm` | SCIM 2.0 (provision + deprovision) | Lifecycle management |
| Entitlements | `entitlements` | SCIM groups / RBAC | Authorization & entitlements |
| Risk Signal Sharing | `riskSignals` | CAEP / Shared Signals Framework | Continuous access evaluation |
| Logout | `logout` | RP-initiated logout / Single Logout | Session management |
| Token Revocation | `tokenRevocation` | OAuth 2.0 revocation / CAE | Credential & token management |

> **Alignment, not certification.** Snout maps a vendor's posture *to* IPSIE-aligned control
> areas using public evidence. It does not assert IPSIE conformance or certification on a
> vendor's behalf.

## Per-control verdicts

For each control the agent returns exactly one verdict, each with a fixed weight:

| Verdict | Weight | Meaning |
|---|---|---|
| `supported` | **100** | Evidence shows the control is supported on an enterprise plan. |
| `partial` | **55** | Partially supported, gated behind a higher tier, or limited in scope. |
| `unknown` | **25** | No conclusive evidence found (the default for any unaddressed control). |
| `unsupported` | **8** | Evidence shows the control is not available. |

`unknown` is the **fail-safe default**: a control with no finding is scored as 25, never
silently treated as supported.

## The score: a transparent mean

The trust score is the **arithmetic mean of the six control weights**, rounded to the nearest
integer. There is no per-control weighting, no tuning constant, and no model in the loop:

```
score = round( (w_sso + w_ulm + w_entitlements + w_riskSignals + w_logout + w_tokenRevocation) / 6 )
```

Worked example — `sso` supported (100), `ulm` supported (100), `entitlements` partial (55),
`riskSignals` unknown (25), `logout` supported (100), `tokenRevocation` unsupported (8):

```
(100 + 100 + 55 + 25 + 100 + 8) / 6 = 388 / 6 = 64.67  →  65
```

The score ranges 8–100 (all `unsupported` to all `supported`). The **server** computes it from
the validated findings — the model never sets the number ([`agent.ts`](./server/src/agent.ts):
`score: computeScore(clean.capabilities)`).

### Readiness bands (UI)

The dashboard buckets the score for at-a-glance readiness. These bands are presentation only;
the underlying number is always shown:

| Score | Band |
|---|---|
| ≥ 80 | Controls Ready |
| 50–79 | Partial |
| < 50 | Not Ready |

## The governance verdict

Separately from the numeric score, the agent drafts a governance **recommendation** — one of
`Approve`, `Approve with conditions`, `Hold`, `Reject` — plus a rationale, conditions, an
owner map, and residual risks. The recommendation is advisory research output, not sign-off:
**a human approves every decision.**

## Grounding modes

A verdict is only as good as its evidence, so every assessment records how it was grounded:

- **`web_search`** — the provider performed live web research (vendor docs, trust centers, the
  OpenID Foundation) and verdicts may carry citations.
- **`reduced`** — the provider has no live web search. Snout then *deterministically* drops all
  citations, downgrades any unproven `supported`/`partial` verdict to `unknown`, and caps the
  recommendation at `Hold`. This prevents ungrounded confidence — see
  [SECURITY.md](./SECURITY.md) and [CHANGELOG.md](./CHANGELOG.md).

Output from every provider passes the same strict schema validation (`validateAgentOutput()`),
which cannot be bypassed.

## Limitations

- Scores reflect **public evidence at assessment time**; vendor capabilities and pricing tiers
  change. Re-assess before relying on an old score.
- Verdicts are AI-generated research and can be wrong — they are a decision aid, not
  professional advice. See [DISCLAIMER.md](./DISCLAIMER.md).
- The mean treats all six controls as equal. If your environment weights, say, SCIM
  deprovisioning above logout, read the per-control verdicts directly — they are all exposed.
