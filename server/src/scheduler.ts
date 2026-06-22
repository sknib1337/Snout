// Scheduled re-assessment (depth D5 / EPIC-OPERATE). Off by default; when
// REASSESS_INTERVAL_HOURS is set, periodically re-runs assessments for apps whose
// last run is stale. Re-running flows through assessApp(), which already does change
// detection + raises alerts on regressions — so this turns monitoring "continuous".
import { Assessment } from "./controls";
import { config } from "./config";
import { store } from "./store";
import { assessApp } from "./agent";

/** Pure selection: stale assessments (oldest first), capped at `max`. Unit-tested. */
export function dueForReassessment(items: Assessment[], staleMs: number, now: number, max: number): Assessment[] {
  return items
    .filter((a) => now - new Date(a.assessedAt).getTime() > staleMs)
    .sort((a, b) => new Date(a.assessedAt).getTime() - new Date(b.assessedAt).getTime())
    .slice(0, Math.max(0, max));
}

async function tick() {
  try {
    const due = dueForReassessment(await store.list(), config.reassessStaleHours * 3600e3, Date.now(), config.reassessBatch);
    for (const a of due) {
      try {
        const url = a.kbKey && a.kbKey.includes(".") ? `https://${a.kbKey}` : undefined;
        const r = await assessApp({ name: a.app, vendor: a.vendor, url });
        await store.upsertByApp(r);
        console.log(`[reassess] ${a.app}: ${r.recommendation} (${r.score})${r.changes?.length ? ` — ${r.changes.length} change(s)` : ""}`);
      } catch (e: any) {
        console.error(`[reassess] ${a.app} failed: ${e.message}`);
      }
    }
  } catch (e: any) {
    console.error(`[reassess] tick failed: ${e.message}`);
  }
}

/** Start the periodic loop if configured (no-op when REASSESS_INTERVAL_HOURS is 0). */
export function startReassessmentLoop() {
  if (!config.reassessIntervalHours) return;
  const ms = config.reassessIntervalHours * 3600e3;
  console.log(`[reassess] every ${config.reassessIntervalHours}h (stale > ${config.reassessStaleHours}h, batch ${config.reassessBatch})`);
  setInterval(tick, ms).unref?.();
}
