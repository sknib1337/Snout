import { describe, it, expect, beforeAll } from "vitest";

let oidc: typeof import("../src/oidc");
let auth: typeof import("../src/security/auth");

beforeAll(async () => {
  process.env.OIDC_ISSUER = "https://idp.example.com";
  process.env.OIDC_CLIENT_ID = "client-id";
  process.env.OIDC_CLIENT_SECRET = "client-secret";
  process.env.OIDC_REDIRECT_URI = "https://app.example.com/auth/callback";
  process.env.SESSION_SECRET = "x".repeat(40);
  process.env.API_TOKEN = ""; // exercise the OIDC-only path
  oidc = await import("../src/oidc");
  auth = await import("../src/security/auth");
});

function fakeReq(headers: Record<string, string>) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { headers: lower, header: (n: string) => lower[n.toLowerCase()] } as never;
}
function fakeRes() {
  const res: { _status?: number; _json?: unknown; status: (c: number) => typeof res; json: (o: unknown) => typeof res } = {
    status(c: number) { res._status = c; return res; },
    json(o: unknown) { res._json = o; return res; },
  };
  return res;
}

describe("oidc session", () => {
  it("mints and verifies a signed session cookie", async () => {
    const token = await oidc.mintSession({ sub: "u1", email: "a@b.com", role: "admin", tenant: "t1" });
    const s = await oidc.readSession(token);
    expect(s?.sub).toBe("u1");
    expect(s?.role).toBe("admin");
    expect(s?.tenant).toBe("t1");
  });

  it("rejects a tampered/invalid token", async () => {
    expect(await oidc.readSession("not.a.jwt")).toBeNull();
  });

  it("readCookie parses a named cookie from the header", () => {
    const req = fakeReq({ cookie: "a=1; snout_session=abc.def.ghi; b=2" });
    expect(oidc.readCookie(req, "snout_session")).toBe("abc.def.ghi");
    expect(oidc.readCookie(req, "missing")).toBeUndefined();
  });
});

describe("apiAuth with OIDC session", () => {
  it("authorizes a request carrying a valid session cookie (role+tenant from session)", async () => {
    const token = await oidc.mintSession({ sub: "u2", role: "viewer", tenant: "tenant-x" });
    const req = fakeReq({ cookie: `${oidc.SESSION_COOKIE}=${token}`, "x-tenant": "attacker-tenant" });
    const res = fakeRes();
    let nexted = false;
    await auth.apiAuth(req, res as never, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect((req as { role?: string }).role).toBe("viewer");
    // session tenant wins over a spoofed x-tenant header
    expect((req as { tenant?: string }).tenant).toBe("tenant-x");
  });

  it("rejects a request with no bearer and no session (401)", async () => {
    const req = fakeReq({});
    const res = fakeRes();
    let nexted = false;
    await auth.apiAuth(req, res as never, () => { nexted = true; });
    expect(nexted).toBe(false);
    expect(res._status).toBe(401);
  });
});
