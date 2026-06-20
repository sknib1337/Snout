import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let store: typeof import("../src/store").store;

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ta-store-"));
  store = (await import("../src/store")).store;
});

describe("discovered store", () => {
  it("creates then merges method flags (OR) and unions idps", async () => {
    await store.upsertDiscovered({ domain: "notion.so", name: "Notion", methods: { social: true }, idps: ["accounts.google.com"] });
    await store.upsertDiscovered({ domain: "notion.so", methods: { password: true }, idps: ["github.com"] });
    const a = await store.getDiscovered("notion.so");
    expect(a?.methods.social).toBe(true);
    expect(a?.methods.password).toBe(true);
    expect(a?.idps.sort()).toEqual(["accounts.google.com", "github.com"]);
  });

  it("links an assessment to a discovered app", async () => {
    await store.upsertDiscovered({ domain: "zoom.us", name: "Zoom" });
    await store.linkAssessment("zoom.us", "assess-123");
    expect((await store.getDiscovered("zoom.us"))?.assessmentId).toBe("assess-123");
  });
});
