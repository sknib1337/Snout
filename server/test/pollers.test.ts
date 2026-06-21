import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let pollers: typeof import("../src/pollers");
let store: typeof import("../src/store").store;

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ta-poll-"));
  process.env.OKTA_LOG_URL = "https://org.okta.com/api/v1/logs";
  process.env.OKTA_API_TOKEN = "ssws-test";
  process.env.ENTRA_TENANT_ID = "tenant";
  process.env.ENTRA_CLIENT_ID = "client";
  process.env.ENTRA_CLIENT_SECRET = "secret";
  pollers = await import("../src/pollers");
  store = (await import("../src/store")).store;
});

afterEach(() => vi.unstubAllGlobals());

describe("pollOkta", () => {
  it("pulls log events, maps via the okta adapter, and upserts discovered apps", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => [
        { eventType: "user.authentication.sso", published: "2026-06-01T10:00:00Z", target: [{ type: "AppInstance", displayName: "Notion", alternateId: "https://www.notion.so/" }] },
      ],
    })));
    const r = await pollers.pollOkta();
    expect(r?.accepted).toBe(1);
    const app = await store.getDiscovered("notion.so");
    expect(app?.sources).toContain("okta-log");
    expect(app?.methods.sso).toBe(true);
  });
});

describe("pollEntra", () => {
  it("fetches a token, pulls signIns, and ingests them", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "tok" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ value: [{ appDisplayName: "Salesforce", servicePrincipalName: "https://saml.salesforce.com", createdDateTime: "2026-06-03T12:00:00Z" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const r = await pollers.pollEntra();
    expect(r?.accepted).toBe(1);
    expect(await store.getDiscovered("salesforce.com")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2); // token + signIns
  });
});
