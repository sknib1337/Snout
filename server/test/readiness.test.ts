import { describe, it, expect, vi, afterEach } from "vitest";

// config.ts reads process.env at import time, so each case resets the module
// registry and re-imports with the env it wants. (Vitest isolates module graphs
// per test file, so this doesn't leak into other files.)
const KEYS = ["LLM_PROVIDER", "ANTHROPIC_API_KEY", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "DATABASE_URL"];
const clear = () => { for (const k of KEYS) delete process.env[k]; };

afterEach(() => { vi.resetModules(); clear(); });

describe("readiness / providerConfigured (EPIC-ACTIVATION)", () => {
  it("anthropic without a key is NOT assess-ready", async () => {
    vi.resetModules(); clear(); process.env.LLM_PROVIDER = "anthropic";
    const { readiness, providerConfigured } = await import("../src/config");
    expect(providerConfigured()).toBe(false);
    const r = readiness();
    expect(r.assessReady).toBe(false);
    expect(r.webSearch).toBe(false);
    expect(r.store).toBe("json");
  });

  it("anthropic with a key is assess-ready WITH web search", async () => {
    vi.resetModules(); clear();
    process.env.LLM_PROVIDER = "anthropic"; process.env.ANTHROPIC_API_KEY = "sk-test";
    const { readiness } = await import("../src/config");
    const r = readiness();
    expect(r.assessReady).toBe(true);
    expect(r.webSearch).toBe(true);
  });

  it("openai needs base+key+model; partial config is not ready and has no web search", async () => {
    vi.resetModules(); clear();
    process.env.LLM_PROVIDER = "openai"; process.env.LLM_API_KEY = "k";
    let mod = await import("../src/config");
    expect(mod.providerConfigured()).toBe(false);

    vi.resetModules();
    process.env.LLM_BASE_URL = "https://api.openai.com"; process.env.LLM_MODEL = "gpt-4o-mini";
    mod = await import("../src/config");
    const r = mod.readiness();
    expect(r.assessReady).toBe(true);
    expect(r.webSearch).toBe(false); // only the anthropic path has live web_search
  });

  it("readiness exposes only booleans/labels — never the key value", async () => {
    vi.resetModules(); clear();
    process.env.LLM_PROVIDER = "anthropic"; process.env.ANTHROPIC_API_KEY = "sk-secret-value";
    const { readiness } = await import("../src/config");
    expect(JSON.stringify(readiness())).not.toContain("sk-secret-value");
  });
});
