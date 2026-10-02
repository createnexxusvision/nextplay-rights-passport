# Architecture decisions (public MVP)

The private infrastructure repo holds the full ADR log; these are the ones that shape this codebase.

**ADR-003: AI is advisory and the engine is authoritative.** Nemotron extracts and explains. `evaluate()` decides. `applyAIGate()` lets AI uncertainty move ALLOWED to NEEDS_REVIEW, and never moves anything toward ALLOWED.

**ADR-008: commitments are salted and domain-separated.** `SHA-256("nextplay:<domain>:v1" ‖ 0x00 ‖ salt32 ‖ canonicalJSON)`. Plain hashes of low-entropy terms (fee, %, territory) can be brute-forced. The salt is private and lives with the plaintext. Losing it means the commitment can never be opened.

**ADR-009: canonicalization sorts by code unit.** We use a JCS-style subset. `localeCompare` gives different bytes on different machines. Semantic normalization (sorting sets, upper-casing codes) happens in the zod schemas, before canonicalization.

**ADR-010: the ledger boundary is type-enforced.** `AnchorResult` only has a `txId` on the `anchored | midnight` variant. Demo mode cannot fabricate one. Anchors take an idempotency key.

**ADR-011: Midnight wallet/token work is gated.** No wallet connection, DUST, NIGHT, seeds or deployments until the Saturday milestone. The core is chain-agnostic, so nothing built now depends on those choices.

**ADR-012: frontend stack.** Vite + React SPA, deployed as static assets on Cloudflare Pages, calling the Fastify API.
- Why: Midnight SDK code is client-only, there is no SSR need, and it avoids the Next-on-Workers adapter.
- It matches the earlier vault prototype's tooling, so components port over.
- It replaces "Next.js" from the draft. *Revisit if you want Next.js.*
