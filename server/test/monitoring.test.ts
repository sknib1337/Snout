import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let store: typeof import("../src/store").store;
let auth: typeof import("../src/security/auth");

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ta-mon-"));
  store = (await import("../src/store")).store;
  auth = await import("../src/security/auth");
});

describe("alerts store (EPIC-OPERATE)", () => {
  it("adds, lists newest-first, and removes", async () => {
    await store.addAlert({ id: "a1", kind: "breach", severity: "high", vendor: "Acme", title: "Acme breach", ts: 100 });
    await store.addAlert({ id: "a2", kind: "change", severity: "medium", vendor: "Acme", title: "sso regressed", ts: 200 });
    let list = await store.listAlerts();
    expect(list.map((a) => a.id)).toEqual(["a2", "a1"]); // newest first
    await store.removeAlert("a1");
    list = await store.listAlerts();
    expect(list.map((a) => a.id)).toEqual(["a2"]);
  });
});

describe("audit log (EPIC-ENTERPRISE)", () => {
  it("records entries newest-first", async () => {
    await store.addAudit({ id: "e1", ts: 1, role: "admin", tenant: "default", method: "POST", path: "/api/assess", status: 200 });
    await store.addAudit({ id: "e2", ts: 2, role: "viewer", tenant: "default", method: "DELETE", path: "/api/x", status: 403 });
    const list = await store.listAudit();
    expect(list[0].id).toBe("e2");
    expect(list.find((e) => e.id === "e1")?.method).toBe("POST");
  });
});

describe("RBAC guards (EPIC-ENTERPRISE)", () => {
  function mockRes() {
    const res: any = { statusCode: 200 };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: any) => { res.body = b; return res; };
    return res;
  }

  it("writeGuard blocks a viewer from mutating but allows GET", () => {
    const next = vi.fn();
    const blocked = mockRes();
    auth.writeGuard({ method: "POST", role: "viewer" } as any, blocked, next);
    expect(blocked.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();

    const allowed = mockRes();
    auth.writeGuard({ method: "GET", role: "viewer" } as any, allowed, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("writeGuard lets an admin mutate; requireAdmin gates non-admins", () => {
    const next = vi.fn();
    auth.writeGuard({ method: "POST", role: "admin" } as any, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);

    const denied = mockRes();
    const n2 = vi.fn();
    auth.requireAdmin({ role: "viewer" } as any, denied, n2);
    expect(denied.statusCode).toBe(403);
    expect(n2).not.toHaveBeenCalled();
  });
});
