# EPIC-CONSOLE-V2 — de-robotized command center

Groomed backlog for the Console v2 design pass. Reference material:
`design_handoff_console_v2/` (PROMPT.md is the spec; `Snout Console v2.dc.html` is the
pixel-final prototype; `tokens/snout.css` is canonical; `assets/` are the brand masters).

**Epic outcome.** The web console and extension popup match the v2 prototype: one token
source of truth, sentence-case Inter chrome with mono reserved for data, the new Command
Center (hero metric · coverage matrix · needs-attention), the sidebar rail (pulse + engine
feed), an accessible toast system replacing every `alert()`, and the new brand mark
everywhere — with CI (lint + server 110 + web tests + builds) green after every sprint.

---

## Scope decisions (settled during grooming — do not re-litigate mid-build)

- **Design-only epic.** The prototype shows future features (reviewer countersign packets,
  "Send to reviewers", "Verify & publish" flows, "Rotate token", a Settings view). These are
  **out of scope** — implement styling/chrome only for features that exist today. No dead
  buttons, no fake nav items. "Settings" enters the nav only when a Settings view ships.
- **No fabricated telemetry.** PROMPT.md's ambient ticker (fake OIDF syncs, fake webhook
  pings) is **rejected**: it contradicts the honest-status work (EPIC-ACTIVATION). The
  engine feed logs **real events only** (assessments, KB actions, readiness changes,
  discovery ingests) plus at most a clearly-labeled periodic heartbeat.
- **Product logic untouched.** Verdict weights (100/55/25/8) and transparent-mean math are
  off-limits (PROMPT.md constraint, reaffirmed).
- **Repo layout stays.** PROMPT.md describes npm workspaces; the repo intentionally uses
  independent `server/`/`web/` packages. Do not restructure.
- **Tests move with copy.** The web test suite asserts UI strings; every copy-sweep story
  includes updating assertions in the same PR — CI green is part of done.

---

## Sprint 1 — Token foundation & de-robotization (reskin, no new components)

**Sprint Goal:** every color/type decision in web + extension reads from `snout.css`
tokens, and all UI chrome speaks sentence-case Inter (mono only for data) — with tests,
builds, and visual spot-checks green.

### S1.1 — Tokens as one source of truth — **M**
As a **maintainer**, I want every surface to consume `--sn-*` tokens from one file so that
palette and contrast changes are made once and propagate everywhere.
- Given `tokens/snout.css` copied to `web/src/tokens.css` and imported in `main.jsx` before
  `index.css`, When the app renders, Then computed styles resolve from `--sn-*` vars and the
  `C` object in `App.jsx` contains only `var(--sn-*)` references.
- Given the same file copied to `extension/tokens.css` and linked from `popup.html` and
  `options.html`, When the popup opens, Then its palette matches the web console and the
  duplicate palette vars formerly at the top of `popup.css` are gone.
- Given any UI text that previously used `#8c909f`, When rendered, Then it uses
  `--sn-text-dim` (#9aa3bd) and `#8c909f` appears only as `--sn-outline` on borders and
  decoration.
- Given the unknown verdict, When a pill renders, Then its color is `--sn-unknown`
  (#9aa3bd), not `#8c909f`.
- Given the full web + extension source, When grepping for legacy hex literals covered by
  tokens, Then only tokens.css itself defines them (legacy alias block may remain until the
  rename completes, then is deleted).

### S1.2 — Typography & copy de-robotization — **L** *(largest story; if it drags, split JSX copy vs STYLES block)*
As a **UAT user**, I want the console to read like a product instead of a terminal so that
non-terminal people trust what they're looking at.
- Given the nav, When rendered, Then items are Inter 500 13px sentence case ("Command
  Center", "Assessments", "Discovered", "Knowledge", "Integrations") and the animated
  scanline sweep is deleted (keyframes removed), while the accent bar + glow remain.
- Given primary buttons, When rendered, Then they are solid `--sn-primary` bg with
  `--sn-on-primary` text, Inter 600 12–12.5px sentence case, hover `brightness(1.08)` — and
  the brand gradient appears nowhere except the logo mark.
- Given ghost buttons and table/section headers, When rendered, Then they match the spec
  (Inter 500 12px + 1px `--sn-border`; headers Inter 500 11px sentence case).
- Given machine-voice strings ("TRUST.SYS · ONLINE", "SYSTEM HEALTHY", "ASSESSED 2D AGO",
  "CONDITIONS — 3"…), When swept, Then they read in sentence case ("Engine online", "System
  healthy", "Assessed 2d ago", "Conditions · 3") everywhere **except** verdict / governance /
  band pills.
- Given verdict, governance, and band pills, When rendered, Then they keep JetBrains Mono
  700 caps with glyph + label + color (✓ ◐ ? ✕ / ✓ ◐ ◷ ✕) on 13% tint bg + 30% tint border —
  color is never the only channel.
- Given provenance/metadata (`◆ kb-verified`, `◇ agent`, `◇ proposed`, `◷ stale Nd`), When
  rendered, Then they are quiet unbordered Inter 500 11px in their spec colors.
- Given the type scale, When audited, Then only 64/44/32/24/18 Hanken · 15/13/12 Inter ·
  11 mono micro remain (9.5–10px mono only for timestamps/axis labels).
- Given the web test suite, When copy changes land, Then assertions are updated in the same
  PR and `npm test` passes.

### S1.3 — Brand assets + rebrand sweep — **M**
As a **first-time visitor**, I want the tab, favicon, social card, and mark to present one
coherent brand so that Snout looks intentional before I read a word.
- Given `web/index.html`, When loaded, Then the title is "Snout — IPSIE-aligned identity
  trust for SaaS", favicon.svg + PNG fallbacks + apple-touch-icon resolve, and OG/Twitter
  meta point at `og-1280x640.png` with the standard description.
- Given the `Logo` component, When rendered, Then it inlines the single-path `mark.svg`
  (gradient #adc6ff→#4edea3, 135°) at 28px with the lowercase "snout" wordmark (Hanken 800,
  -0.015em) and the lucide ShieldCheck version is removed.
- Given the extension, When loaded unpacked, Then `extension-icon{16,48,128}.png` replace
  the old icons, the ⛨ glyph is the inline mark SVG, and Hanken/Inter/JetBrains Mono load
  from local woff2 `@font-face` (no silent system-ui fallback).
- Given `manifest.json`, When reviewed, Then name/description match the spec, and no
  "Enterprise SaaS Controls" string remains anywhere in web or extension.
- Given the store listing implications of the manifest rename, When this ships, Then the
  change is called out in the PR description (店-facing metadata; cheap to revert, but
  visible).

### S1.4 — Calm the ShaderBG — **S**
As a **daily user**, I want the background quieter so that motion never competes with data.
- Given ShaderBG, When animating, Then time step is ~0.010, mouse-glow intensity ×0.7, grid
  alpha 0.025 — and the `prefers-reduced-motion` fallback still renders static.

---

## Sprint 2 — Command Center & sidebar rail (new components, real data only)

**Sprint Goal:** the Command Center answers "how healthy is my portfolio and what needs
me?" at a glance — hero metric, per-control coverage matrix, and a live needs-attention
queue — all computed from real state.

### S2.1 — Hero metric panel — **M**
As a **security lead**, I want one hero number with band + trend context so that I can read
portfolio posture in two seconds.
- Given ≥1 assessment, When Command Center renders, Then the glass hero shows "Portfolio
  trust" (Inter 500 12.5 dim), the mean score at Hanken 800 50px, the band pill beside it,
  and the caption "Mean score of N assessed vendors…".
- Given the divider, When rendered, Then three quiet stats (Controls Ready · Assessed ·
  Discovered-unassessed in amber) show as Hanken 700 26px + Inter 12px captions.
- Given zero assessments, When rendered, Then the existing empty state (with Load sample
  data) still appears — the hero never renders NaN.

### S2.2 — Control coverage matrix (`CoverageMatrix`) — **L**
As a **security lead**, I want a vendors × controls grid so that systemic weaknesses (one
control failing everywhere) are visible without opening each assessment.
- Given assessed vendors, When the matrix renders, Then it is `1.1fr repeat(6, 1fr)` with
  one row per vendor and mono 9.5px control headers (SSO, SCIM, ENTITLE, CAEP/SSF, LOGOUT,
  REVOKE).
- Given a cell, When rendered, Then it is a 24px rounded-6 chip: verdict glyph in verdict
  color on a 10% tint; When hovered, Then a tooltip shows control name, verdict, confidence %.
- Given a row click, When fired, Then the app navigates to that vendor's Detail view.
- Given the header, When computed, Then "Weakest: <control> — supported by N of M" reflects
  live state; and the footer legend shows all four glyphs.
- Given one vendor only, When rendered, Then the matrix still lays out correctly (no
  degenerate grid).

### S2.3 — Needs-attention panel (real queues only) — **M**
As a **solo operator**, I want a single queue of everything waiting on me so that nothing
rots silently.
- Given pending KB proposals, stale evidence (>180d), or discovered-unassessed apps, When
  the panel renders, Then each appears as glyph + Inter 12px row + → with hover bg; When
  clicked, Then the app navigates to the relevant view (Knowledge / Detail / Discovered).
- Given none of those exist, When rendered, Then the panel shows "All clear — nothing
  waiting on you. ✓".
- *(Scope note: "packets awaiting countersign" excluded — no such feature exists.)*

### S2.4 — Portfolio pulse (sidebar) — **S**
As a **user glancing at the rail**, I want a stacked ready/partial/not-ready band so that
distribution is visible without opening Command Center.
- Given assessments change, When scores update, Then the 6px stacked bar widths and the "N
  ready · N partial · N not ready" caption recompute.

### S2.5 — Engine feed (honest events) — **M**
As a **user**, I want a live feed of what the engine actually did so that activity is
visible without fabricating telemetry.
- Given real app actions (assessment started/completed, KB verify/reject, discovery ingest,
  readiness/state changes), When they occur, Then rows append newest-first as mono 9.5px
  HH:MM:SS + kind glyph + Inter 11px text, list capped ~40, bottom fade gradient.
- Given the wrapper, When the sidebar is short, Then the feed clips (`flex:1; min-height:0;
  overflow:hidden`) and never overlaps the footer.
- Given no activity, When idle, Then at most a clearly-labeled heartbeat row appears
  (paused when `document.hidden`) — **no invented events** (fake ticker rejected; see scope
  decisions).
- Given the footer, When readiness changes, Then the status dot + "Engine online / degraded
  / offline / Setup needed" + right-aligned mono version track the real readiness state.

---

## Sprint 3 — Feedback layer & extension parity

**Sprint Goal:** no native `alert()` remains anywhere; every async outcome surfaces as an
accessible toast or persistent banner, and the extension popup matches the v2 brand.

### S3.1 — Toast system — **M**
As a **user**, I want non-blocking, accessible notifications so that outcomes never
interrupt me with browser modals.
- Given a toast fires, When rendered, Then it matches the glass recipe (26px glyph tile,
  Inter 600 12 title / 400 12 body, optional solid action button, ✕ dismiss), bottom-right,
  newest on top, max 3 visible with a "+N more" chip and "Clear all".
- Given severities, When success/info fire, Then they auto-dismiss in 6s with a 2px
  progress bar (hover pauses); When warn/error fire, Then they persist until dismissed.
- Given a screen reader, When toasts fire, Then the region is `aria-live="polite"` (errors
  `assertive`); Given ESC, When pressed, Then all toasts clear; Given reduced motion, When
  set, Then fade-only.

### S3.2 — Replace alerts + persistent banners — **M**
As a **user**, I want failures explained in place with a next step so that I can recover
without dev tools.
- Given KnowledgeView verify/reject or Discovered→assess fails, When the error returns,
  Then a toast appears (no `alert()` anywhere in `web/src` — grep is the test).
- Given backend-offline / reduced-grounding / setup-needed states, When active, Then the
  existing banners restyle to the v2 recipes (red / amber / periwinkle tint, env var in a
  mono code chip) below the header — banners, not toasts.
- Given the web tests, When banner copy changes, Then assertions update in the same PR.

### S3.3 — Extension popup parity — **M**
As an **extension user**, I want the popup to look and speak like the console so that both
surfaces read as one product.
- Given the popup, When opened, Then it consumes `tokens.css`, bundled local fonts, the new
  mark, and sentence-case chrome — and its alerts use the compact vanilla toast.

### S3.4 — Chart a11y affordances — **S**
As a **color-blind user**, I want glyph + label companions on the radar and dial so that
color is never the only channel.
- Given the radar, When rendered, Then vertices carry value labels + verdict-colored dots
  with glyphs; Given the ScoreDial, When rendered, Then a glyph + band label sits beside it.

---

## Sizing summary

| Sprint | Stories | S / M / L |
|---|---|---|
| 1 — Foundation reskin | 4 | 1S · 2M · 1L |
| 2 — Command Center + rail | 5 | 1S · 3M · 1L |
| 3 — Feedback + extension | 4 | 1S · 3M |

Two Ls (S1.2 copy sweep, S2.2 matrix) are the split candidates if either exceeds a day.

## Solo retro prompt (close of each sprint)

1. What actually shipped versus the Sprint Goal?
2. What slowed me down or got re-worked, and why?
3. One change to try next sprint.
