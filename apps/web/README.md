# Web app

Vite + React SPA (ADR-012). Uses `@nextplay/core` **in the browser**, so file fingerprints and policy seals are computed on the user's device. Files are never uploaded. Salts stay in memory unless the user saves a private copy.

```bash
npm run dev:api     # terminal 1: API on :8080 (reads ../../.env)
npm run dev:web     # terminal 2: http://localhost:5173 (proxies /api → :8080)
npm run build:web   # static build → apps/web/dist (deploy to Cloudflare Pages)
```

Production: set `VITE_API_BASE_URL` to the API's public origin, and set `CORS_ORIGINS` on the API to the Pages URL. `VITE_*` values ship to browsers, so never put a secret in one.

## Demo flow (fits a 3-minute video)
1. Register the asset: fingerprinted locally
2. Credit contributors: splits must total 100%
3. Set and seal the rights policy: versioned, salted seal, with a "Save private copy" button
4. Check a request: free text (Nemotron reads it) or the structured form (works with AI off)
5. The passport stamps **Allowed / Denied / Needs review** with reasons, and shows Nemotron's reading as advisory
6. Record the policy seal: demo-labelled until the Midnight milestone

The design uses NextPlay navy and gold, with Archivo's width axis: condensed for display, normal for body. The decision stamp is the one animated moment, and it is disabled under `prefers-reduced-motion`.
