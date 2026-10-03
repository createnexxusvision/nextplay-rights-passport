# agent/ — the rights agent's home

A Unix-style layout. The runtime (`apps/api/src/agent/`) reads **only** these
fixed paths at startup, validates every file, and refuses to start if one is
wrong. Nothing here is fetched from the network or written at runtime.

```
agent/
├── etc/agent.json        config: the loop, phases, reasoning per phase, token budgets
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

**Budgets** (`etc/agent.json` plus env): a per-phase `maxTokens`, at most
`maxIterations` model calls per request, and global daily caps on calls
(`AI_DAILY_CALL_LIMIT`) and billed tokens (`AI_DAILY_TOKEN_BUDGET`). When a cap
is hit, the AI path switches off and the structured form still works.

## Rules that never change

See `share/context/boundary.md`. In short: the engine decides, the model only
reads; the policy never reaches the model; model output that fails its schema is
discarded; fee and duration come only from the text.
