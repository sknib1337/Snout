// KB coverage + verification health (EPIC-MOAT Sprint 2). Prints how much of the
// knowledge base is human-verified vs machine-proposed, how many vendors are fully
// verified, and how many verified facts are stale. Read-only, no network.
//   npm run kb:stats
import { CONTROLS, ControlKey } from "../src/controls";
import { kbStats } from "../src/kb";

const pct = (n: number) => (n * 100).toFixed(1) + "%";

async function main() {
  const s = await kbStats();
  console.log("Snout KB stats");
  console.log("──────────────");
  console.log(`Vendors:            ${s.vendors}`);
  console.log(`Facts:              ${s.facts}`);
  console.log(`  human-verified:   ${s.bySource.human} (${pct(s.verifiedRatio)})`);
  console.log(`  agent-proposed:   ${s.bySource.agent}`);
  console.log(`  seed:             ${s.bySource.seed}`);
  console.log(`Fully-verified:     ${s.fullyVerifiedVendors}/${s.vendors} vendors (all covered controls human-verified)`);
  console.log(`Stale verified:     ${s.staleVerified} (verifiedAt older than the freshness window)`);
  console.log("Control coverage (vendors with any fact):");
  for (const c of CONTROLS) console.log(`  ${c.key.padEnd(16)} ${s.controlCoverage[c.key as ControlKey]}`);
}

main();
