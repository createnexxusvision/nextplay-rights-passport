# Web (next milestone)

Vite + React SPA → Cloudflare Pages (ADR-012). Uses `@nextplay/core` in the browser so hashing and commitments happen client-side; salts never leave the device unless the user exports them.

Screens (demo flow, < 3 min):
1. Register asset: local SHA-256, no upload
2. Contributors and splits (basis points, validated)
3. Rights policy editor → salted commitment
4. Brand / AI-agent request (free text) → `/rights/analyze`
5. Decision: Allowed / Denied / Needs review + reasons + model metadata
6. Proof Passport: public-safe fields only; "DEMO — not committed to Midnight" until Saturday
7. Technical drawer: commitments and engine/model versions

Never shown in the main flow: DUST, NIGHT, addresses, seed phrases, circuits.
