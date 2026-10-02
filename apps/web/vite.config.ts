import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: /api is proxied to the Fastify API on :8080 (same-origin, no CORS needed).
// Prod: set VITE_API_BASE_URL to the API origin (a public URL, never a secret).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8080", "/health": "http://localhost:8080" } },
  build: { target: "es2022", sourcemap: true },
});
