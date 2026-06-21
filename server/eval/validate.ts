// Validate every kb/<domain>.json against the KB schema. Exits non-zero on any
// error so it can gate CI (`npm run kb:validate`).
import fs from "fs";
import path from "path";
import { validateKbFile } from "../src/kb";

const dir = path.resolve(__dirname, "..", "..", "kb");
let bad = 0, ok = 0;
for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".json") && n !== "schema.json")) {
  let errs: string[];
  try { errs = validateKbFile(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"))); }
  catch (e: any) { errs = [`unparseable JSON: ${e.message}`]; }
  if (errs.length) { bad++; console.error(`✗ ${name}: ${errs.join("; ")}`); }
  else { ok++; console.log(`✓ ${name}`); }
}
console.log(`[kb:validate] ${ok} ok, ${bad} bad`);
process.exit(bad ? 1 : 0);
