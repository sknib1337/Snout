import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Isolate the data dir per test file before any module loads (see test/setup.ts).
    setupFiles: ["./test/setup.ts"],
  },
});
