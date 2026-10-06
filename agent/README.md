# agent/ — the rights agent's home

A Unix-style layout. The runtime (`apps/api/src/agent/`) reads **only** these
fixed paths at startup, validates every file, and refuses to start if one is
wrong. Nothing here is fetched from the network or written at runtime.

```
agent/
├── etc/agent.json        config: the loop, phases, reasoning per phase, token budgets
├── etc/models.json       model tiers (light / standard / heavy), prices, routing rules
├── bin/*.json            tool manifests: every step the loop can run (code or model)
├── skills/*.md           one prompt per model phase           → SENT to the model
├── share/context/*.md    domain rules
│   ├── field-rules.md    how to read each field              → SENT to the model
│   └── boundary.md       what the agent may and may not do    (runtime/humans only)
└── share/data/*.json     lookup tables for the code tools     (never sent)
```

## The loop

Every request runs the same sequence. The agent only answers when it reaches
`done`. Steps marked *code* cost zero tokens.

| # | Step (`bin/`) | Kind | Does |
|---|---|---|---|
| 1 | `prescan` | code | Text that tries to instruct the AI → human review. Stop. |
| 2 | `facts` | code | Fee, duration, channels, countries, credit, read from the text (`share/data`). |
| 3 | `triage` | code | Clear request → **fast** path. A judgement call (`share/data/triage.json`) → **deep** path. |
| 4 | `classify` | model, reasoning **off** | Fast path. One reading: use type, commercial, likeness, AI use, confidence. |
| 4 | `plan` | model, reasoning **on** | Deep path. Brainstorm up to 3 plausible readings, most likely first. |
| 5 | `repair` | code | Only ever adds caution (an ad is commercial, voice cloning uses likeness…). |
| 6 | `evaluate` | code | The policy engine decides each reading. The model never sees the policy. |
| 7 | `verify` | code | Fast path unsure or repaired → loop back to `plan` (once). Readings disagree → human review. |
| 8 | `explain` | code | Plain-language summary from the final terms. |

## Which model does the work

`etc/models.json` maps work to the cheapest model that does it well. The
router is code (zero tokens) and runs before every model call:

| Work | Tier | Default model | $/1M in / out |
|---|---|---|---|
| `classify` — routine reading, fast path | light | Nemotron-3.5-Lightning | 0.06 / 0.24 |
| `plan` — judgement, brainstorming | standard | Nemotron-3-Super-120B | 0.30 / 0.90 |
| `plan` with workload ≥ `heavyAtWorkload` | heavy | Nemotron-3-Ultra-550B | 1.00 / 3.00 |

Workload score = judgement signals matched in `share/data/triage.json`
+ 1 if the text has conflicting facts + 1 if it is long (> 400 chars)
+ 1 if a cheaper model already failed or was unsure. A failed or unsure call
moves **up** a tier, never down. Heavy calls are also refused when they would
not fit today's dollar budget; the standard model is used instead.

`npm run models:route` benchmarks candidates on the eval corpus and rewrites
the tiers with the cheapest model that passes (spend-capped; see the script).

**Budgets** (`etc/agent.json` plus env): a per-phase `maxTokens`, at most
`maxIterations` model calls per request, and global daily caps on calls
(`AI_DAILY_CALL_LIMIT`), billed tokens (`AI_DAILY_TOKEN_BUDGET`) and dollars
(`AI_DAILY_BUDGET_USD`, priced per model from `etc/models.json`), plus a
per-client share (`AI_PER_CLIENT_DAILY_CALLS`). Budget is reserved against the
real prompt size, not a flat allowance. When a cap
is hit, the AI path switches off and the structured form still works.

## Rules that never change

See `share/context/boundary.md`. In short: the engine decides, the model only
reads; the policy never reaches the model; model output that fails its schema is
discarded; fee and duration come only from the text.
