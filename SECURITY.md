# Security

Experimental MVP; not audited. Please report issues privately via GitHub Security Advisories on this repository rather than in public issues.

Ground rules this repo enforces:
- No secrets in git (`.gitignore` blocks `.env*`; CI runs gitleaks). Server credentials come from env/secret manager only.
- No `VITE_*`/`NEXT_PUBLIC_*` variable may ever hold a secret — those ship to browsers.
- Request bodies are never logged (they may contain private terms). Commitment salts are never logged or stored server-side.
- No wallet seeds, private keys, or Midnight private state exist in this repo or its runtime in the current milestone.
