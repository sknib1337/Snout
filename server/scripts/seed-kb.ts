// Batch KB seeder (depth D2). Runs the live assessment agent over a vendor list;
// each run writes unverified `agent` proposals into the KB (via recordProposals),
// so the knowledge base fills at scale instead of by hand. A human then promotes
// proposals to verified in the dashboard (Knowledge view) or via POST /api/kb.
//
//   npm run seed:kb                       # uses scripts/seed-vendors.json
//   npm run seed:kb -- vendors.json       # custom list: [{ "name": "...", "url": "https://..." }]
//
// Requires a working LLM provider (ANTHROPIC_API_KEY etc.) — this is a live tool,
// not part of CI. Runs sequentially with a delay to respect rate limits.
import fs from "fs";
import path from "path";
import { assessApp } from "../src/agent";
import { store } from "../src/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const file = process.argv[2] || path.resolve(__dirname, "seed-vendors.json");
  const vendors: { name: string; url?: string }[] = JSON.parse(fs.readFileSync(file, "utf8"));
  const delayMs = Number(process.env.SEED_DELAY_MS || 3000);
  console.log(`[seed] ${vendors.length} vendors from ${file} (delay ${delayMs}ms)`);

  let ok = 0, fail = 0;
  for (const v of vendors) {
    try {
      const r = await assessApp({ name: v.name, url: v.url });
      await store.upsertByApp(r);
      console.log(`[seed] ✓ ${v.name} — score ${r.score}, ${r.recommendation} (proposals written for non-unknown controls)`);
      ok++;
    } catch (e: any) {
      console.error(`[seed] ✗ ${v.name}: ${e.message}`);
      fail++;
    }
    await sleep(delayMs);
  }
  console.log(`[seed] done: ${ok} ok, ${fail} failed. Review proposals in the dashboard Knowledge view.`);
}

main();
