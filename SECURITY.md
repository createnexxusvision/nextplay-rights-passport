# Security

Experimental MVP; not audited. Please report issues privately via GitHub Security Advisories on this repository rather than in public issues.

Ground rules this repo enforces:
- No secrets in git (`.gitignore` blocks `.env*`; CI runs gitleaks). Server credentials come from env/secret manager only.
- No `VITE_*`/`NEXT_PUBLIC_*` variable may ever hold a secret — those ship to browsers.
- Request bodies are never logged (they may contain private terms). Commitment salts are never logged or stored server-side.
- The decision-receipt signing key (`RECEIPT_SIGNING_KEY`) is server-only and comes from a secret manager. Production refuses to start without it.
- The API listens on loopback unless `HOST` says otherwise, so a dev machine on shared Wi-Fi doesn't expose the AI budget or the receipt signer.
- An AI-read "allowed" is never signed. Receipts are issued for confirmed structured terms, or for cautious outcomes.
- The Lace integration is read-only (address and network). No seeds, mnemonics or private keys are requested, and nothing is signed in this build.
- No wallet seeds, private keys, or Midnight private state exist in this repo or its runtime in the current milestone.

Cryptographic schemes and their guarantees are documented in [`docs/CRYPTOGRAPHY.md`](docs/CRYPTOGRAPHY.md).
