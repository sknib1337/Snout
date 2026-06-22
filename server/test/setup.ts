import fs from "fs";
import os from "os";
import path from "path";

// Run before each test file is imported. Point DATA_DIR at a fresh per-file temp
// directory so tests never read or write the real ./data dir. This matters because
// some test files statically import modules that load `config` (and the store
// singleton) at file-load time — before any beforeAll can redirect DATA_DIR — which
// previously caused the JSON store to accumulate state in ./data across runs.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "snout-test-"));
// Force the JSON store in tests regardless of any ambient DATABASE_URL.
delete process.env.DATABASE_URL;
