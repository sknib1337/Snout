import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

const target = process.env.SERVER_URL || "http://localhost:8787";
const DEMO = process.env.VITE_DEMO === "true";

export default defineConfig({
  // Demo build inlines everything into one index.html with relative paths so it
  // opens via file:// with no server. Normal build serves from root behind nginx.
  base: DEMO ? "./" : "/",
  plugins: [react(), ...(DEMO ? [viteSingleFile()] : [])],
  server: {
    port: 5173,
    proxy: {
      "/api": { target, changeOrigin: true },
      "/webhooks": { target, changeOrigin: true },
      "/slack": { target, changeOrigin: true },
      "/teams": { target, changeOrigin: true },
    },
  },
});
