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
