import { config } from "../config";
import { AnthropicProvider } from "./anthropic";
import { OpenAICompatibleProvider } from "./openai";
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
  if (name === "openai") {
    if (!config.llmBaseUrl) throw new Error("LLM_BASE_URL is not configured");
    if (!config.llmApiKey) throw new Error("LLM_API_KEY is not configured");
    if (!config.llmModel) throw new Error("LLM_MODEL is not configured");
    return new OpenAICompatibleProvider();
  }
  throw new Error(`Unknown LLM_PROVIDER "${name}". Use "anthropic" or "openai".`);
}
