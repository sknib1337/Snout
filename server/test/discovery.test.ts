import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { idpAdapters, emailToUpsert, sanitizeUpsert } from "../src/discovery";

describe("IdP log adapters", () => {
  it("okta: SSO event -> sso+federated, domain from app alternateId", () => {
    const u = idpAdapters.okta({
      eventType: "user.authentication.sso",
      published: "2026-06-01T10:00:00.000Z",
      target: [{ type: "AppInstance", displayName: "Notion", alternateId: "https://www.notion.so/" }],
    });
    expect(u?.domain).toBe("notion.so");
    expect(u?.name).toBe("Notion");
    expect(u?.methods?.sso).toBe(true);
    expect(u?.methods?.federated).toBe(true);
    expect(u?.methods?.oauthGrant).toBe(false);
    expect(u?.sources).toContain("okta-log");
    expect(u?.events?.[0].kind).toBe("sso");
  });

  it("okta: OAuth consent event -> oauthGrant + scopes + clientId", () => {
    const u = idpAdapters.okta({
      eventType: "app.oauth2.as.consent.grant",
      published: "2026-06-02T08:00:00.000Z",
      target: [{ type: "AppInstance", displayName: "Figma" }],
      debugContext: { debugData: { redirectUri: "https://figma.com/oauth/callback", clientId: "abc123", scopes: "openid email files.read" } },
    });
    expect(u?.domain).toBe("figma.com");
    expect(u?.methods?.oauthGrant).toBe(true);
    expect(u?.oauth?.[0].clientId).toBe("abc123");
    expect(u?.oauth?.[0].scopes).toEqual(["openid", "email", "files.read"]);
  });

  it("okta: no resolvable domain -> null (skipped)", () => {
    expect(idpAdapters.okta({ eventType: "user.session.start", target: [{ type: "AppInstance", displayName: "Mystery" }] })).toBeNull();
  });

  it("entra: sign-in -> sso, host reduced to registrable domain (eTLD+1)", () => {
    const u = idpAdapters.entra({
      appDisplayName: "Salesforce",
      servicePrincipalName: "https://saml.salesforce.com",
      createdDateTime: "2026-06-03T12:00:00Z",
      clientAppUsed: "Browser",
    });
    expect(u?.domain).toBe("salesforce.com"); // saml.salesforce.com reduced to eTLD+1
    expect(u?.methods?.sso).toBe(true);
    expect(u?.idps).toContain("entra");
  });

  it("registrableDomain reduces subdomains and respects multi-part suffixes", async () => {
    const { registrableDomain } = await import("../src/discovery");
    expect(registrableDomain("app.notion.so")).toBe("notion.so");
    expect(registrableDomain("saml.salesforce.com")).toBe("salesforce.com");
    expect(registrableDomain("foo.bar.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("slack.com")).toBe("slack.com");
  });

  it("entra: appId-only event (no domain) -> null", () => {
    expect(idpAdapters.entra({ appDisplayName: "X", servicePrincipalName: "00000000-0000-0000-0000-000000000000" })).toBeNull();
  });

  it("google: authorize event -> oauthGrant + scopes, domain from app_domain", () => {
    const u = idpAdapters.google({
      id: { time: "2026-06-04T09:30:00Z" },
      events: [{ name: "authorize", parameters: [
        { name: "app_name", value: "Loom" },
        { name: "app_domain", value: "loom.com" },
        { name: "oauth_client_id", value: "cid-9" },
        { name: "scope", multiValue: ["https://www.googleapis.com/auth/userinfo.email"] },
      ] }],
    });
    expect(u?.domain).toBe("loom.com");
    expect(u?.name).toBe("Loom");
    expect(u?.methods?.oauthGrant).toBe(true);
    expect(u?.oauth?.[0].clientId).toBe("cid-9");
    expect(u?.oauth?.[0].scopes?.length).toBe(1);
  });
});

describe("email discovery", () => {
  it("signup subject from a vendor domain -> upsert keyed by sender domain", () => {
    const u = emailToUpsert({ from: "Slack <feedback@slack.com>", subject: "Confirm your email address", date: "2026-05-01T00:00:00Z" });
    expect(u?.domain).toBe("slack.com");
    expect(u?.name).toBe("Slack");
    expect(u?.sources).toContain("email");
    expect(u?.events?.[0].kind).toBe("signup");
  });

  it("signup sender local-part also triggers (subject unremarkable)", () => {
    const u = emailToUpsert({ from: "no-reply@linear.app", subject: "Your weekly digest" });
    expect(u?.domain).toBe("linear.app");
  });

  it("ignores personal mailbox domains", () => {
    expect(emailToUpsert({ from: "welcome@gmail.com", subject: "Welcome!" })).toBeNull();
  });

  it("ignores non-signup mail from a normal sender", () => {
    expect(emailToUpsert({ from: "marketing@randomsaas.io", subject: "10 tips for your team" })).toBeNull();
  });
});

describe("sanitizeUpsert", () => {
  it("rejects an invalid domain", () => {
    expect(sanitizeUpsert({ domain: "not a domain", sources: ["x"] })).toBeNull();
  });

  it("clamps fields and caps arrays", () => {
    const u = sanitizeUpsert({
      domain: "EXAMPLE.com",
      name: "x".repeat(200),
      idps: Array.from({ length: 20 }, (_, i) => `idp${i}.com`),
      events: Array.from({ length: 40 }, (_, i) => ({ ts: i, source: "s", kind: "k", detail: "d" })),
    });
    expect(u?.domain).toBe("example.com");
    expect(u?.name?.length).toBe(80);
    expect(u?.idps?.length).toBe(10);
    expect(u?.events?.length).toBe(20);
  });
});

describe("discovered store: history + cross-sensor merge", () => {
  let store: typeof import("../src/store").store;
  beforeAll(async () => {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ta-disc-"));
    store = (await import("../src/store")).store;
  });

  it("merges sensors by domain: unions sources/methods and appends events", async () => {
    await store.upsertDiscovered({ domain: "airtable.com", name: "Airtable", methods: { password: true }, sources: ["extension"], events: [{ ts: 1, source: "extension", kind: "password" }] });
    await store.upsertDiscovered({ domain: "airtable.com", methods: { sso: true }, sources: ["okta-log"], events: [{ ts: 2, source: "okta-log", kind: "sso" }] });
    const a = await store.getDiscovered("airtable.com");
    expect(a?.methods.password).toBe(true);
    expect(a?.methods.sso).toBe(true);
    expect(a?.sources.sort()).toEqual(["extension", "okta-log"]);
    expect(a?.events?.length).toBe(2);
  });

  it("caps history at 50 events (oldest fall off)", async () => {
    for (let i = 0; i < 60; i++) {
      await store.upsertDiscovered({ domain: "zoom.us", events: [{ ts: i, source: "okta-log", kind: "sso" }] });
    }
    const a = await store.getDiscovered("zoom.us");
    expect(a?.events?.length).toBe(50);
    expect(a?.events?.[0].ts).toBe(10); // first 10 dropped
    expect(a?.events?.[49].ts).toBe(59);
  });
});
