// Load an ESM-only package (`jose`, `openid-client`) lazily. Kept behind a helper
// so the two opt-in features (OIDC login, Google poller) only pull these in when
// configured. Under tsc's CommonJS output this compiles to a require() of the ESM
// module, which Node resolves via the unflagged require(esm) support on Node
// >= 20.19 / 22.12 (see package.json "engines"); tsx and vitest handle the dynamic
// import natively.
export function importESM<T = unknown>(specifier: string): Promise<T> {
  return import(specifier) as Promise<T>;
}
