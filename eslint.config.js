import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const vitestGlobals = {
  describe: "readonly", it: "readonly", test: "readonly", expect: "readonly", vi: "readonly",
  beforeAll: "readonly", afterAll: "readonly", beforeEach: "readonly", afterEach: "readonly",
};

export default [
  { ignores: ["**/dist/**", "**/build/**", "**/node_modules/**", "**/coverage/**", "snout-demo.html", "**/*.min.js"] },

  js.configs.recommended,

  // Conservative baseline: real bugs are errors; style/intent rules are off or warn.
  { rules: { "no-empty": ["error", { allowEmptyCatch: true }] } },

  // Server (TypeScript) — non-type-checked recommended (fast).
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["server/**/*.ts"] })),
  {
    files: ["server/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-control-regex": "off", // input sanitizer intentionally matches control chars
    },
  },

  // Browser extension (Manifest V3): browser + webextension (`chrome`) globals.
  {
    files: ["extension/**/*.js"],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // Web (React / JSX).
  {
    files: ["web/**/*.{js,jsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: "latest", sourceType: "module" },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^[A-Z_]" }],
    },
  },

  // Web tests (Vitest globals are injected via vitest.config.js `globals: true`).
  {
    files: ["web/**/*.test.{js,jsx}", "web/test/**"],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...vitestGlobals } },
  },

  // Build/test config + Node scripts need Node globals.
  {
    files: ["**/*.config.{js,ts}"],
    languageOptions: { globals: { ...globals.node } },
  },
];
