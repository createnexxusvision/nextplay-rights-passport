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

## Model choice (checked 2026-10-03)

`npm run models` listed four Nemotron models: `NVIDIA-Nemotron-3-Nano-30B-A3B`, `Nemotron-3_5-Lightning`, `nemotron-3-super-120b-a12b` and `Nemotron-3-Ultra-550b-a55b`. We use **`nvidia/nemotron-3-super-120b-a12b`**. It passes the eval corpus 9/9 on three runs in a row, at about 6–8 s per request.

Wiring notes:
- **Reasoning tokens.** Nemotron 3 reasons before it answers, and those tokens count against `max_tokens`. With 1200, the JSON answer got cut off. The gateway now uses 4096 and reports `finish_reason: "length"` as `truncated`. Reasoning text is never read or returned.
- **Structured output.** The request sends `response_format: json_schema` with the extraction schema. This stopped invented enum values (we saw `"aiGeneration"` instead of `"ai_generation"` about 1 time in 10). The strict zod parse is still the final check.
- **Bursts.** 12 parallel calls caused some 20 s timeouts. Normal use is one call per check, and the API rate limit (20/min on `/analyze`) plus `AI_DAILY_CALL_LIMIT` keep it there.
