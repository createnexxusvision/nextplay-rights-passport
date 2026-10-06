import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { midnightOrigins, pagesHeaders } from "./security-headers";

// Emits dist/_headers (Cloudflare Pages): strict CSP, HSTS, no third-party origins.
function securityHeaders(apiBaseUrl: string | undefined, extraConnect: string[]): Plugin {
  return {
    name: "nextplay-security-headers",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: pagesHeaders(apiBaseUrl, extraConnect) });
    },
  };
}

// Dev: /api is proxied to the Fastify API on :8080 (same-origin, no CORS needed).
// Prod: set VITE_API_BASE_URL to the API origin (a public URL, never a secret).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), securityHeaders(env.VITE_API_BASE_URL, midnightOrigins([env.VITE_PROOF_SERVER_URL, env.VITE_INDEXER_URL]))],
    server: { proxy: { "/api": "http://localhost:8080", "/health": "http://localhost:8080" } },
    // No data: URIs: every asset is a same-origin file, so the CSP needs no data: for fonts.
    build: { target: "es2022", sourcemap: true, assetsInlineLimit: 0 },
  };
});
