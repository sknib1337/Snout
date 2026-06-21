import { config } from "../config";
import { AnthropicProvider } from "./anthropic";
import type { LLMProvider } from "./types";

export type { LLMProvider, CompletionInput, SearchResult } from "./types";

/**
 * Select the LLM provider from config. Fails closed (throws a clear error) when
 * the selected provider's required config is missing, so a misconfiguration
 * surfaces immediately instead of producing a confusing upstream error.
 */
export function getProvider(): LLMProvider {
  const name = config.llmProvider;
  if (name === "anthropic") {
    if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured on the server");
    return new AnthropicProvider();
  }
  throw new Error(`Unknown LLM_PROVIDER "${name}". Supported: "anthropic".`);
}
