// Provider abstraction. agent.ts builds the (sanitized, fenced) prompt and ALWAYS
// runs validateAgentOutput() on the result; a provider only turns a system+user
// prompt into raw assistant text. validateAgentOutput is deliberately kept OUTSIDE
// this interface so no provider implementation can ever bypass the security schema.

export interface CompletionInput {
  system: string;
  user: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface LLMProvider {
  /** Short provider id, e.g. "anthropic" | "openai". */
  readonly name: string;
  /** True only if the provider grounds answers with live web search itself. */
  readonly supportsWebSearch: boolean;
  /** Turn a system+user prompt into raw assistant text. */
  complete(input: CompletionInput): Promise<string>;
  /**
   * Optional seam for a future external search step, used by agent.ts only when
   * supportsWebSearch is false. Results are UNTRUSTED and must be fenced inside
   * the <<UNTRUSTED_INPUT>> block and run through safeUrl() by the caller.
   * Unimplemented today — present so grounding can be added without reworking
   * the trust boundary.
   */
  search?(query: string): Promise<SearchResult[]>;
}
