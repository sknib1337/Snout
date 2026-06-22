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
  // Split heavy vendors (recharts, react) into their own chunks for the normal
  // build so no single chunk exceeds Vite's 500 kB advisory and the big charting
  // lib is cached separately from app code. The demo is intentionally left as one
  // inlined file (viteSingleFile requires a single chunk), so don't chunk it.
  build: DEMO ? undefined : {
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) chunking: isolate the big charting lib and React.
        advancedChunks: {
          groups: [
            { name: "recharts", test: /node_modules[\\/](recharts|recharts-scale|d3-[^\\/]+|victory-vendor|internmap)[\\/]/ },
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler|react-is)[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target, changeOrigin: true },
      "/auth": { target, changeOrigin: true },
      "/webhooks": { target, changeOrigin: true },
      "/slack": { target, changeOrigin: true },
      "/teams": { target, changeOrigin: true },
    },
  },
});
