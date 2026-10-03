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

**The model only makes judgement calls.** Everything code can read the same way every time, code reads:

| Who | What |
|---|---|
| Code (`extractRequestFacts`) | fee and currency, duration (incl. "2 weeks", "60-day", "perpetual"), channels (Instagram → social, website → web…), countries, credit offered. A fee or duration not in the text is never used. Two different fees or durations → human review. |
| Code (`describeUseRequest`) | the plain-language explanation shown to reviewers |
| Nemotron | use type, commercial, likeness, AI generation/training, sublicensing, confidence; channels/countries only as a fallback when code finds none |

The policy is **not** sent to the model: extraction doesn't need the owner's private terms.

**Tokens, 8 eval calls** (the injection case never reaches the model):

| | Before | Now |
|---|---|---|
| Output | 8,024 (6,502 of it hidden reasoning) | **559** |
| Prompt | 6,314 | **1,930** |
| Eval | 9/9 | **9/9** (3 runs in a row) |

Wiring notes:
- Reasoning is off by default via `chat_template_kwargs: { enable_thinking: false }` (`/no_think` has no effect on Token Factory; `reasoning_effort: "low"` only halves it). Set `AI_REASONING=on` to compare. `finish_reason: "length"` is reported as `truncated`.
- `response_format: json_schema` constrains output to valid enum values (without it we saw `"aiGeneration"` for `"ai_generation"` about 1 time in 10). The strict zod parse stays the final check.
- `npm run eval` prints token totals per run.
