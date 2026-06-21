import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// These tests mock the global fetch (HTTP layer) — no real network calls. config is
// computed once at import from process.env, so we set env then dynamic-import with a
// fresh module registry per test.

const ENV_KEYS = [
  "LLM_PROVIDER",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_BASE_URL",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.resetModules();
});

const setEnv = (env: Record<string, string>) => {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
};
const mockFetch = (impl: any) => vi.stubGlobal("fetch", vi.fn(impl));
const anthropicRes = (text: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ content: [{ type: "text", text }] }),
  text: async () => "",
});
const openaiRes = (content: any) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
  text: async () => "",
});

describe("provider factory (fail-closed selection)", () => {
  it("defaults to AnthropicProvider with only ANTHROPIC_API_KEY", async () => {
    setEnv({ ANTHROPIC_API_KEY: "k" });
    const { getProvider } = await import("../src/llm");
    const p = getProvider();
    expect(p.name).toBe("anthropic");
    expect(p.supportsWebSearch).toBe(true);
  });

  it("selects OpenAICompatibleProvider for LLM_PROVIDER=openai", async () => {
    setEnv({ LLM_PROVIDER: "openai", LLM_BASE_URL: "https://gw.example.com", LLM_API_KEY: "k", LLM_MODEL: "m" });
    const { getProvider } = await import("../src/llm");
    const p = getProvider();
    expect(p.name).toBe("openai");
    expect(p.supportsWebSearch).toBe(false);
  });

  it("throws on an unknown LLM_PROVIDER", async () => {
    setEnv({ LLM_PROVIDER: "bogus" });
    const { getProvider } = await import("../src/llm");
    expect(() => getProvider()).toThrow(/Unknown LLM_PROVIDER/);
  });

  it("throws when openai is selected without base/key/model", async () => {
    setEnv({ LLM_PROVIDER: "openai" });
    const { getProvider } = await import("../src/llm");
    expect(() => getProvider()).toThrow();
  });
});

describe("AnthropicProvider request", () => {
  it("posts to the default base with the web_search tool and returns text", async () => {
    setEnv({ ANTHROPIC_API_KEY: "secret-key", ANTHROPIC_MODEL: "claude-x" });
    let captured: any;
    mockFetch(async (url: string, init: any) => {
      captured = { url, init };
      return anthropicRes("hello");
    });
    const { getProvider } = await import("../src/llm");
    const out = await getProvider().complete({ system: "S", user: "U" });
    expect(out).toBe("hello");
    expect(captured.url).toBe("https://api.anthropic.com/v1/messages");
    expect(captured.init.headers["x-api-key"]).toBe("secret-key");
    expect(captured.init.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(captured.init.body);
    expect(body.tools[0].type).toBe("web_search_20250305");
    expect(body.max_tokens).toBe(4000);
    expect(body.model).toBe("claude-x");
  });

  it("honors ANTHROPIC_BASE_URL (trailing slash trimmed)", async () => {
    setEnv({ ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: "https://proxy.internal:8443/" });
    let url = "";
    mockFetch(async (u: string) => {
      url = u;
      return anthropicRes("ok");
    });
    const { getProvider } = await import("../src/llm");
    await getProvider().complete({ system: "S", user: "U" });
    expect(url).toBe("https://proxy.internal:8443/v1/messages");
  });
});

describe("OpenAICompatibleProvider", () => {
  it("posts chat/completions with bearer auth and parses content", async () => {
    setEnv({ LLM_PROVIDER: "openai", LLM_BASE_URL: "https://api.openai.com", LLM_API_KEY: "bk", LLM_MODEL: "m" });
    let captured: any;
    mockFetch(async (url: string, init: any) => {
      captured = { url, init };
      return openaiRes("answer");
    });
    const { getProvider } = await import("../src/llm");
    const out = await getProvider().complete({ system: "S", user: "U" });
    expect(out).toBe("answer");
    expect(captured.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(captured.init.headers.authorization).toBe("Bearer bk");
    expect(JSON.parse(captured.init.body).messages.map((m: any) => m.role)).toEqual(["system", "user"]);
  });

  it("throws a clean error on null / non-string content", async () => {
    setEnv({ LLM_PROVIDER: "openai", LLM_BASE_URL: "https://api.openai.com", LLM_API_KEY: "bk", LLM_MODEL: "m" });
    mockFetch(async () => openaiRes(null));
    const { getProvider } = await import("../src/llm");
    await expect(getProvider().complete({ system: "S", user: "U" })).rejects.toThrow(/empty or non-text/);
  });
});

describe("error handling never leaks upstream bodies or keys", () => {
  it("throws a fixed status message, not the response body", async () => {
    setEnv({ LLM_PROVIDER: "openai", LLM_BASE_URL: "https://api.openai.com", LLM_API_KEY: "bk", LLM_MODEL: "m" });
    const leaky = "Authorization: Bearer bk LEAKED-SECRET-TOKEN echoed by gateway";
    mockFetch(async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => leaky }));
    const { getProvider } = await import("../src/llm");
    let err: any;
    try {
      await getProvider().complete({ system: "S", user: "U" });
    } catch (e) {
      err = e;
    }
    expect(err.message).toBe("LLM request failed: 401");
    expect(err.message).not.toContain("LEAKED-SECRET-TOKEN");
    expect(err.message).not.toContain("bk");
  });
});

describe("assessApp always validates and enforces grounding", () => {
  const adversarial = JSON.stringify({
    app: "Evil",
    summary: "x".repeat(5000),
    capabilities: { sso: { verdict: "TOTALLY_SUPPORTED", citations: [{ title: "x", url: "javascript:alert(1)" }] } },
    recommendation: "DEFINITELY APPROVE",
    conditions: Array.from({ length: 50 }, (_, i) => "c" + i),
  });

  it("clamps adversarial output through validateAgentOutput (Anthropic path)", async () => {
    setEnv({ ANTHROPIC_API_KEY: "k" });
    mockFetch(async () => anthropicRes("noise before " + adversarial + " noise after"));
    const { assessApp } = await import("../src/agent");
    const rec = await assessApp({ name: "Evil Corp" });
    expect(Object.keys(rec.capabilities).sort()).toEqual(
      ["entitlements", "logout", "riskSignals", "sso", "tokenRevocation", "ulm"].sort(),
    );
    expect(rec.summary.length).toBeLessThanOrEqual(1200);
    expect(rec.recommendation).toBe("Hold"); // invalid -> Hold
    expect(rec.capabilities.sso.verdict).toBe("unknown"); // invalid verdict coerced
    expect(rec.capabilities.sso.citations.every((c) => !c.url.includes("javascript"))).toBe(true);
    expect(rec.conditions.length).toBeLessThanOrEqual(10);
    expect(rec.grounding).toBe("web_search");
  });

  it("reduced grounding (non-search provider): drops citations, downgrades positive verdicts, caps recommendation", async () => {
    setEnv({ LLM_PROVIDER: "openai", LLM_BASE_URL: "https://gw", LLM_API_KEY: "k", LLM_MODEL: "m" });
    const positive = JSON.stringify({
      app: "Acme",
      capabilities: {
        sso: { verdict: "supported", citations: [{ title: "looks real", url: "https://acme.com/sso" }] },
        ulm: { verdict: "partial", citations: [] },
      },
      recommendation: "Approve",
    });
    mockFetch(async () => openaiRes(positive));
    const { assessApp } = await import("../src/agent");
    const rec = await assessApp({ name: "Acme" });
    expect(rec.grounding).toBe("reduced");
    expect(rec.capabilities.sso.verdict).toBe("unknown");
    expect(rec.capabilities.sso.citations).toEqual([]);
    expect(rec.capabilities.ulm.verdict).toBe("unknown");
    expect(rec.recommendation).toBe("Hold");
  });
});

describe("safeBaseUrl trust boundary", () => {
  it("allows internal/loopback gateways and public hosts (unlike safeUrl)", async () => {
    const { safeBaseUrl, safeUrl } = await import("../src/security/sanitize");
    expect(safeBaseUrl("http://[::1]:11434")).toBeTruthy();
    expect(safeBaseUrl("http://127.0.0.1:4000")).toBeTruthy();
    expect(safeBaseUrl("https://api.anthropic.com")).toBeTruthy();
    // safeUrl stays strict for untrusted URLs — the boundary is intact.
    expect(safeUrl("http://127.0.0.1:4000")).toBeNull();
  });

  it("rejects non-http(s) schemes and embedded credentials", async () => {
    const { safeBaseUrl } = await import("../src/security/sanitize");
    expect(safeBaseUrl("file:///etc/passwd")).toBeNull();
    expect(safeBaseUrl("https://user:pass@gw.example.com")).toBeNull();
    expect(safeBaseUrl("not a url")).toBeNull();
  });
});
