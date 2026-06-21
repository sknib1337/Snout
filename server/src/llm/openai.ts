import { config } from "../config";
import type { CompletionInput, LLMProvider } from "./types";

// OpenAI-compatible Chat Completions provider. Covers OpenAI, LiteLLM (OpenAI mode),
// OpenRouter, and local servers such as vLLM and Ollama. No native web search — see
// the reduced-grounding handling in agent.ts. LLM_BASE_URL is the server root WITHOUT
// a path; we append /v1/chat/completions (trailing slashes are trimmed in config).
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = "openai";
  readonly supportsWebSearch = false;

  async complete({ system, user }: CompletionInput): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    let res: Response;
    try {
      res = await fetch(`${config.llmBaseUrl}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.llmApiKey}`,
        },
        body: JSON.stringify({
          model: config.llmModel,
          max_tokens: 4000,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      // Third-party gateways are more likely to echo auth headers / request bodies
      // in error responses, so never return the upstream body or key to the client.
      const detail = await res.text().catch(() => "");
      console.error(`[llm:openai] request failed ${res.status}: ${detail.slice(0, 200)}`);
      throw new Error(`LLM request failed: ${res.status}`);
    }

    const data: any = await res.json();
    // Gateways vary: content may be null, an array of parts, or tool_call objects.
    // Require a non-empty string so nothing undefined reaches the validator.
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("LLM returned an empty or non-text completion");
    }
    return content;
  }
}
