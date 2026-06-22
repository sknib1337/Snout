import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Assessment, ControlFact } from "../src/controls";

// Record every SQL call the PgStore makes so we can prove tenant scoping without a
// live database. Pool.query handles the non-transactional paths; connect() returns
// a client used for the read-modify-write transactions.
const poolCalls: { text: string; params: unknown[] }[] = [];
const clientCalls: { text: string; params: unknown[] }[] = [];

vi.mock("pg", () => {
  class Pool {
    async query(text: string, params: unknown[] = []) { poolCalls.push({ text, params }); return { rows: [] }; }
    async connect() {
      return {
        async query(text: string, params: unknown[] = []) { clientCalls.push({ text, params }); return { rows: [] }; },
        release() {},
      };
    }
  }
  return { Pool };
});

import { createPgStore } from "../src/store.pg";

const TENANT = "tenant-a";
// Schema bootstrap (CREATE TABLE ...) isn't a tenant-scoped data query; exclude it.
const dataCalls = () => poolCalls.filter((c) => !/CREATE TABLE/i.test(c.text));
const fact: ControlFact = { verdict: "supported", confidence: 1, standards: [], summary: "x", citations: [], source: "human" };
const assessment = { id: "a1", app: "Slack", assessedAt: "2026-06-01T00:00:00Z" } as unknown as Assessment;

beforeEach(() => { poolCalls.length = 0; clientCalls.length = 0; });

describe("PgStore tenant isolation", () => {
  it("scopes every non-transactional query to the tenant as $1", async () => {
    const store = createPgStore(TENANT);
    await store.list();
    await store.get("a1");
    await store.upsertByApp(assessment);
    await store.remove("a1");
    await store.listDiscovered();
    await store.getDiscovered("slack.com");
    await store.removeDiscovered("slack.com");
    await store.linkAssessment("slack.com", "a1");
    await store.listKbOverrides();
    await store.getKbOverride("slack.com");
    await store.listAlerts();
    await store.addAlert({ id: "al1", kind: "change", severity: "low", vendor: "Slack", title: "t", ts: 1 });
    await store.removeAlert("al1");
    await store.listAudit();
    await store.addAudit({ id: "au1", ts: 1, role: "admin", tenant: TENANT, method: "POST", path: "/x" });

    const calls = dataCalls();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.text.toLowerCase()).toContain("tenant");
      expect(c.params[0]).toBe(TENANT); // tenant is always the first bound parameter
    }
  });

  it("scopes transactional read-modify-write paths (FOR UPDATE) to the tenant", async () => {
    const store = createPgStore(TENANT);
    await store.upsertDiscovered({ domain: "slack.com", sources: ["okta-log"] });
    await store.upsertKbControl("slack.com", "Slack", "sso", fact);

    const txQueries = clientCalls.filter((c) => c.params.length > 0); // skip BEGIN/COMMIT
    expect(txQueries.length).toBeGreaterThan(0);
    for (const c of txQueries) {
      expect(c.text.toLowerCase()).toContain("tenant");
      expect(c.params[0]).toBe(TENANT);
    }
    // The transaction is opened and committed.
    expect(clientCalls.some((c) => /BEGIN/i.test(c.text))).toBe(true);
    expect(clientCalls.some((c) => /COMMIT/i.test(c.text))).toBe(true);
  });

  it("two tenants issue queries bound to their own tenant id", async () => {
    await createPgStore("tenant-a").list();
    await createPgStore("tenant-b").list();
    const lists = dataCalls().filter((c) => /FROM snout_assessments/i.test(c.text));
    expect(lists.map((c) => c.params[0])).toEqual(["tenant-a", "tenant-b"]);
  });
});
