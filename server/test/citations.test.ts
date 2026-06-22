import { describe, it, expect, afterEach, vi } from "vitest";
import { citationMatches, fetchText, groundFindings } from "../src/citations";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(map: Record<string, { status?: number; body?: string }>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const m = map[url] ?? { status: 404, body: "" };
    return { status: m.status ?? 200, arrayBuffer: async () => Buffer.from(m.body ?? "") } as any;
  }));
}

describe("citationMatches", () => {
  it("matches on control keyword, standard, or vendor; false on empty", () => {
    expect(citationMatches("Configure SAML single sign-on", "sso", [], undefined)).toBe(true);
    expect(citationMatches("We support SCIM 2.0 provisioning", "ulm", [], undefined)).toBe(true);
    expect(citationMatches("nothing relevant here", "sso", ["SAML"], "Acme")).toBe(false);
    expect(citationMatches("about Acme corp", "sso", [], "Acme")).toBe(true);
    expect(citationMatches("", "sso", [], undefined)).toBe(false);
  });
});

describe("fetchText (SSRF-guarded)", () => {
  it("returns null for a private/invalid URL without fetching", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await fetchText("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(await fetchText("http://localhost/x")).toBeNull();
    expect(spy).not.toHaveBeenCalled(); // safeUrl blocked it before any fetch
  });

  it("does not chase redirects (3xx → null) but returns 2xx body", async () => {
    mockFetch({ "https://ok.com/": { status: 200, body: "SAML page" }, "https://redir.com/": { status: 301, body: "" } });
    expect(await fetchText("https://ok.com/")).toBe("SAML page");
    expect(await fetchText("https://redir.com/")).toBeNull();
  });
});

describe("groundFindings", () => {
  it("drops mismatching citations, keeps matching + unfetchable, leaves KB-verified alone", async () => {
    mockFetch({
      "https://good.com/": { status: 200, body: "Enterprise SAML SSO setup" },
      "https://bad.com/": { status: 200, body: "marketing fluff, nothing relevant" },
      "https://down.com/": { status: 500, body: "" },
    });
    const caps: any = {
      sso: { verdict: "supported", standards: ["SAML"], summary: "x", source: "agent",
        citations: [{ title: "good", url: "https://good.com/" }, { title: "bad", url: "https://bad.com/" }, { title: "down", url: "https://down.com/" }] },
      ulm: { verdict: "supported", standards: ["SCIM"], summary: "x", source: "kb-verified",
        citations: [{ title: "bad", url: "https://bad.com/" }] },
    };
    const out = await groundFindings(caps, "Acme", {});
    const urls = out.sso.citations.map((c: any) => c.url);
    expect(urls).toContain("https://good.com/");   // matched → kept
    expect(urls).toContain("https://down.com/");   // unfetchable → kept (no false drop)
    expect(urls).not.toContain("https://bad.com/"); // mismatch → dropped
    expect(out.ulm.citations).toHaveLength(1);       // kb-verified untouched
  });
});
