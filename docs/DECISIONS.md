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

**ADR-015: signed receipts, encrypted private copies, field-level disclosure.** The API signs each decision with Ed25519, and the passport verifies the signature before it shows "Signed". Private copies are encrypted with PBKDF2 (600k iterations) and AES-256-GCM. Policies can also be committed as a salted Merkle tree, so a single field can be proven on its own. Details are in [`CRYPTOGRAPHY.md`](CRYPTOGRAPHY.md).

**ADR-016: the rights agent is a fixed loop with a Unix-style home.** `agent/` holds config (`etc/`), tool manifests (`bin/`), one prompt per phase (`skills/`), and data and context (`share/`). The runtime validates it at startup. The loop is fixed: prescan, facts, triage, classify or plan, repair, evaluate, verify, explain. It always answers at the end, and the model never calls tools. Reasoning is spent only where judgement is needed: the `plan` phase, on the deep path. Hard daily token and call budgets protect the credit.
