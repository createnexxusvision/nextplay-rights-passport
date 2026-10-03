# NextPlay Rights Passport

**AI-native rights intelligence for athlete and creator content.**
A brand or AI agent asks *"can I use this asset for this purpose?"*. An NVIDIA Nemotron model on Nebius turns the messy request into structured rights data, a deterministic policy engine returns **Allowed / Denied / Needs review**, and the athlete gets a shareable Proof Passport. Private terms are committed, never published.

> ⚠️ **Experimental hackathon MVP, not audited.** This is not legal advice. It does not determine ownership or infringement, it moves no money, and in this milestone it makes no blockchain transactions.

## How a decision is made

```text
 requestText ──► Nemotron (Nebius Token Factory) ──► strict schema check ──┐
  (untrusted)     extracts + explains, never decides     (reject on fail)   │
                                                                           ▼
 rights policy ─────────────────────────────────────────► Policy Engine (deterministic)
 (versioned, salted commitment)                               │
                                                              ▼
                                          ALLOWED / DENIED / NEEDS_REVIEW + reasons
                                          AI can only make a result MORE cautious
```

| Rule | Where it is enforced |
|---|---|
| The AI never decides. It extracts, explains and flags missing info. | `apps/api/src/ai-gateway.ts`, `applyAIGate` |
| Malformed or injected model output degrades to *Needs review*. | `AIExtraction` strict schema |
| The app stays useful with the AI off. | `POST /api/v1/rights/evaluate` |
| Commitments are salted and domain-separated, so terms can't be brute-forced. | `packages/core/src/commitment.ts` |
| Canonical JSON is locale-independent, so the same policy gives the same hash everywhere. | `packages/core/src/canonical.ts` |
| Money is integer minor units and splits are basis points that sum to exactly 10000. | `schemas.ts`, `splits.ts` |
| Demo mode can never emit a transaction id. | `ledger.ts` (enforced by the type) |
| An AI-read approval only covers the terms the AI extracted, and the requester must confirm them. Text that tries to instruct the AI goes to a person. | `server.ts`, `injection.ts` |
| Decisions come with an Ed25519-signed receipt. The passport shows "Signed" only after verifying it. | `receipts.ts`, `GET /api/v1/keys` |
| The private copy of your terms is encrypted with your passphrase (PBKDF2 600k → AES-256-GCM). | `vault.ts` |
| You can prove one policy field (say, "no AI training") without revealing the rest. | `merkle.ts` |

## Layout

```text
packages/core        canonicalization, commitments, schemas, policy engine, splits, ledger boundary
apps/api             Fastify API + Nebius/Nemotron gateway + eval runner
apps/web             Vite + React app: register → splits → policy seal → request check → passport
contracts/           Midnight RightsRegistry spec (wallet/token work gated, see contracts/README.md)
evals/               fixed rights-analysis corpus (allowed / denied / ambiguous / injection)
docs/                decisions, cryptography, hackathon checklist
```

## Run

```bash
nvm use            # Node 22+
npm install
npm test           # unit + API + crypto tests, no network needed
npm run typecheck
cp .env.example .env   # add Nebius credentials to enable the AI
npm run dev:api        # http://localhost:8080/health
npm run dev:web        # http://localhost:5173 (second terminal)
npm run build:web      # static build + Cloudflare Pages _headers (CSP, HSTS)
npm run models         # list Nemotron model ids your Nebius key can use
npm run eval           # live Nemotron eval corpus (needs NEBIUS_*)
```

### API

| Method | Path | AI | Purpose |
|---|---|---|---|
| GET | `/health` | n/a | Liveness and AI status |
| POST | `/api/v1/rights/evaluate` | no | `{ policy, request, policySeal? }` → deterministic decision (`basis: "structured_terms"`) + signed receipt |
| POST | `/api/v1/rights/analyze` | yes | `{ policy, requestText, policySeal? }` → injection pre-scan → Nemotron extraction → engine decision. An ALLOWED here is provisional until the requester confirms the extracted terms through `evaluate`. |
| GET | `/api/v1/keys` | n/a | Ed25519 public keys for verifying decision receipts |

`policySeal` is `{ commitment, salt }`, the opening of the caller's policy seal. With it, the API binds its signed receipt to that seal. Server settings (`AI_DAILY_CALL_LIMIT`, `TRUST_PROXY`, `RECEIPT_SIGNING_KEY`) are documented in [`.env.example`](.env.example). See [`docs/CRYPTOGRAPHY.md`](docs/CRYPTOGRAPHY.md) for every scheme and its parameters.

## How Nebius and NVIDIA are used

The `analyze` endpoint calls an NVIDIA Nemotron model served by **Nebius Token Factory** through its OpenAI-compatible chat-completions API (`NEBIUS_BASE_URL`, `NEBIUS_MODEL`). The model converts free-text use requests into a strict `UseRequest` schema and writes a reviewer-facing explanation. Every response records the model id and latency. [`docs/NEBIUS.md`](docs/NEBIUS.md) explains why this uses Token Factory rather than AI Cloud.

## Status

See [`docs/HACKATHON.md`](docs/HACKATHON.md) for the build checklist and the disclosure of prior work.

## License

Apache-2.0
