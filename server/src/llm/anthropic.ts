import { config } from "../config";
import type { CompletionInput, LLMProvider } from "./types";

// Anthropic Messages API with the server-side web_search tool. This is the default
// provider; with only ANTHROPIC_API_KEY set, the request it sends is identical to
// Snout's original hardcoded call (base URL defaults to https://api.anthropic.com).
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly supportsWebSearch = true;

  async complete({ system, user }: CompletionInput): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    let res: Response;
    try {
      res = await fetch(`${config.anthropicBaseUrl}/v1/messages`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": config.anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.anthropicModel,
          max_tokens: 4000,
          system,
          messages: [{ role: "user", content: user }],
          // Least-privilege tooling: read-only web search, capped uses.
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      // Log detail server-side only; never return the upstream body (a gateway may
      // echo headers/keys) or the API key to the client.
      const detail = await res.text().catch(() => "");
      console.error(`[llm:anthropic] request failed ${res.status}: ${detail.slice(0, 200)}`);
      throw new Error(`LLM request failed: ${res.status}`);
    }

    const data: any = await res.json();
    return (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
  }
}
