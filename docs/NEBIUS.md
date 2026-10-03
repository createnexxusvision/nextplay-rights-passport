# Building on Nebius: Token Factory vs. AI Cloud

Checked 2026-10-02 against Nebius docs and the Token Factory launch release (2025-11-05).

| | **Token Factory** | **AI Cloud** |
|---|---|---|
| What it is | Managed inference API for open models. It is the successor to Nebius AI Studio. | The underlying cloud: GPU VMs, Managed Kubernetes, Slurm, S3-compatible storage, managed databases, registry, serverless jobs and endpoints, MLflow, and a vLLM app |
| You manage | API calls only | GPUs, model serving (e.g. vLLM), scaling, patching |
| Billing | Per token | Per resource-hour (GPUs bill while running, even when idle) |
| Models | 60+ open models, including NVIDIA Nemotron, Llama, Qwen, DeepSeek. LoRA and full fine-tuning. | Any model you can run, including your own weights |
| Production extras | Dedicated endpoints (99.9% SLA, isolation), zero-retention inference in EU/US, SOC 2 Type II / ISO 27001 | Full network and data control (VPCs, security groups), and you host the whole stack |
| Time to first result | Minutes | Hours to days |

**This repo uses Token Factory.** It covers the hackathon's Nebius + NVIDIA requirement with the least operational work. The API is OpenAI-compatible (`https://api.tokenfactory.nebius.com/v1`) and supports `response_format` JSON / JSON-schema.

**AI Cloud comes later**, for any of these:
- hosting the Fastify API, Postgres and the Midnight proof server in one place;
- serving a fine-tuned model on dedicated GPUs;
- strict data-residency or network-isolation requirements.

Setup:
1. Create a key at tokenfactory.nebius.com.
2. Put `NEBIUS_API_KEY` in `.env`.
3. Run `npm run models` and copy an exact Nemotron id into `NEBIUS_MODEL`.
4. Run `npm run eval`.

## Model choice and token use (checked 2026-10-03)

`npm run models` listed four Nemotron models: `NVIDIA-Nemotron-3-Nano-30B-A3B`, `Nemotron-3_5-Lightning`, `nemotron-3-super-120b-a12b` and `Nemotron-3-Ultra-550b-a55b`. We use **`nvidia/nemotron-3-super-120b-a12b`**.

The model runs inside the agent loop described in [`agent/README.md`](../agent/README.md). Code does everything it can do deterministically, at zero tokens: the injection pre-scan, fee/duration/channels/countries/credit, triage, cautious repairs, the engine decision and the explanation. The model only makes judgement calls:
- **Fast path** (`classify`, reasoning off): clear requests. One reading, ~350 tokens.
- **Deep path** (`plan`, reasoning on at low effort): requests with a judgement call (sponsor, AI, face or voice, editorial-but-paid…), or an unsure or self-contradicting fast answer. Up to 3 readings, ~550 tokens. The engine decides each reading; if the readings disagree, a person decides.

The policy is never sent to the model.

**Tokens, eval corpus** (`npm run eval`, single runs):

| Setup | Calls | Prompt | Output (reasoning) | Eval |
|---|---|---|---|---|
| Original (reasoning on, policy sent, model writes everything) | 8 | 6,314 | 8,024 (6,502) | 6/9 → 9/9 after fixes |
| Agent loop | 8 | 2,600 | 738 (134) | 9/9 |
| Agent loop, judgement cases 10–11 | 2 | 690 | 150 (5) | 2/2 |

**Model routing** (`agent/etc/models.json`, chosen by code before each call, zero tokens):

| Work | Tier | Model | $/1M in / out | Cost per check (eval) |
|---|---|---|---|---|
| Routine reading (fast path) | light | Nemotron-3.5-Lightning | 0.06 / 0.24 | ~$0.000033 |
| Judgement, brainstorming (deep path) | standard | Nemotron-3-Super-120B | 0.30 / 0.90 | ~$0.00024 |
| Deep path with workload ≥ 4 | heavy | Nemotron-3-Ultra-550B | 1.00 / 3.00 | only if today's dollars allow |

A failed or unsure call is retried one tier **up**, never down. Full eval with routing: 11/11 for **$0.0011**. `npm run models:route` benchmarks candidates cheapest-first on the matching eval cases and keeps the first model that gets all of them right (`-- --write` saves it; `ROUTE_USD_CAP`, default $0.05, caps the run). The 2026-10-03 run cost $0.003: Lightning passed 7/7 routine cases. For judgement, Lightning passed 2/4 (its reasoning ran past the output limit) and Nano passed 4/4; Super stays the standard tier until the judgement corpus is larger than 4 cases.

**Credit guard.** `AI_DAILY_BUDGET_USD` (priced per tier), `AI_DAILY_TOKEN_BUDGET` (billed tokens per UTC day) and `AI_DAILY_CALL_LIMIT`. A heavy call that wouldn't fit today's dollars runs on the standard model instead. A call only starts if its worst case fits; otherwise the deep pass is skipped (the fast result stays cautious) or `/analyze` returns 503 and the form takes over. `npm run eval` is capped at `EVAL_TOKEN_CAP` (25,000) per run; `EVAL_ONLY=10,11` runs a subset. `AI_REASONING=off` turns reasoning off everywhere.

Wiring notes:
- Reasoning on/off per call via `chat_template_kwargs: { enable_thinking }`, with `reasoning_effort` bounding it (`/no_think` has no effect on Token Factory). `finish_reason: "length"` is reported as `truncated`.
- `response_format: json_schema` constrains output to valid enum values; the strict zod parse stays the final check.
