import { Media, UseType } from "@nextplay/core";

/**
 * Rights Intelligence gateway → Nebius Token Factory (OpenAI-compatible API)
 * serving an NVIDIA Nemotron model. One function: send one phase's prompt and
 * get back parsed JSON plus billed token usage.
 *
 * Boundary (docs/DECISIONS.md ADR-003, agent/share/context/boundary.md):
 *  - The model reads requests. It never decides, never sees the policy, never calls tools.
 *  - Only the request text is sent, as a JSON string of untrusted DATA.
 *  - Output is shape-constrained by a JSON Schema here and re-validated with zod by the caller.
 */
export interface AIConfig {
  baseUrl: string;
  /** Only used when routing is "off": one model for every phase. */
  model: string;
  /** "auto" picks a model per call from agent/etc/models.json. "off" uses `model` everywhere. */
  routing: "auto" | "off";
  apiKey: string;
  timeoutMs: number;
  /** "off" forces reasoning off in every phase (cost kill switch). "auto" uses agent/etc/agent.json. */
  reasoning: "auto" | "off";
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  reasoning: number;
}

export type ModelCall =
  | { status: "ok"; json: unknown; model: string; latencyMs: number; usage: TokenUsage }
  | { status: "error"; reason: "timeout" | "http" | "parse" | "truncated"; model: string; latencyMs: number; usage: TokenUsage };

export const MAX_AI_TIMEOUT_MS = 25_000;

export function loadAIConfig(env: NodeJS.ProcessEnv = process.env): AIConfig | null {
  const { NEBIUS_BASE_URL, NEBIUS_MODEL, NEBIUS_API_KEY, AI_TIMEOUT_MS, AI_REASONING, AI_MODEL_ROUTING } = env;
  if (!NEBIUS_BASE_URL || !NEBIUS_API_KEY) return null;
  const routing = AI_MODEL_ROUTING?.trim().toLowerCase() === "off" ? "off" : "auto";
  if (routing === "off" && !NEBIUS_MODEL) throw new Error("AI_MODEL_ROUTING=off needs NEBIUS_MODEL");
  return {
    baseUrl: NEBIUS_BASE_URL.replace(/\/$/, ""),
    model: NEBIUS_MODEL ?? "",
    routing,
    apiKey: NEBIUS_API_KEY,
    // Capped below the server's 30 s request timeout (S4) so a slow model can't hold sockets open.
    timeoutMs: Math.min(Math.max(Number(AI_TIMEOUT_MS ?? 20000) || 20000, 1000), MAX_AI_TIMEOUT_MS),
    reasoning: AI_REASONING?.trim().toLowerCase() === "off" ? "off" : "auto",
  };
}

/** JSON Schemas mirroring core's ModelRequest / AIModelOutput / AIPlanOutput. */
const READING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["useType", "media", "territory", "commercial", "aiTraining", "aiGeneration", "likeness", "sublicensing"],
  properties: {
    useType: { type: "string", enum: UseType.options },
    media: { type: "array", items: { type: "string", enum: Media.options } },
    territory: { type: "array", items: { type: "string", pattern: "^(?:[A-Z]{2}|WORLD)$" } },
    commercial: { type: "boolean" },
    aiTraining: { type: "boolean" },
    aiGeneration: { type: "boolean" },
    likeness: { type: "boolean" },
    sublicensing: { type: "boolean" },
  },
} as const;
const CONFIDENCE = { type: "number", minimum: 0, maximum: 1 } as const;
export const CLASSIFY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["request", "confidence"],
  properties: { request: READING_SCHEMA, confidence: CONFIDENCE },
} as const;
export const planJsonSchema = (maxReadings: number) =>
  ({
    type: "object",
    additionalProperties: false,
    required: ["readings", "confidence"],
    properties: { readings: { type: "array", minItems: 1, maxItems: maxReadings, items: READING_SCHEMA }, confidence: CONFIDENCE },
  }) as const;

export interface PhaseRequest {
  /** Model chosen by the router for this call. */
  model: string;
  system: string;
  requestText: string;
  schema: object;
  reasoning: "off" | "low" | "medium" | "high";
  maxTokens: number;
}

export async function callModel(cfg: AIConfig, req: PhaseRequest, fetchImpl: typeof fetch = fetch): Promise<ModelCall> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const none: TokenUsage = { prompt: 0, completion: 0, reasoning: 0 };
  const reasoning = cfg.reasoning === "off" ? "off" : req.reasoning;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: req.model,
        temperature: 0,
        max_tokens: req.maxTokens,
        // Nemotron 3 on Token Factory: thinking on/off per call; effort bounds how long it thinks.
        chat_template_kwargs: { enable_thinking: reasoning !== "off" },
        ...(reasoning !== "off" ? { reasoning_effort: reasoning } : {}),
        response_format: { type: "json_schema", json_schema: { name: "rights_reading", schema: req.schema } },
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: JSON.stringify({ requestText: req.requestText }) },
        ],
      }),
    });
    if (!res.ok) return { status: "error", reason: "http", model: req.model, latencyMs: elapsed(), usage: none };
    const body = (await res.json()) as {
      model?: string;
      choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number | null } };
    };
    const usage: TokenUsage = {
      prompt: body.usage?.prompt_tokens ?? 0,
      completion: body.usage?.completion_tokens ?? 0,
      reasoning: body.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    };
    // Only the final answer is read; reasoning text is ignored and never returned.
    if (body.choices?.[0]?.finish_reason === "length") return { status: "error", reason: "truncated", model: req.model, latencyMs: elapsed(), usage };
    try {
      const json = JSON.parse(stripFences(body.choices?.[0]?.message?.content ?? "")) as unknown;
      return { status: "ok", json, model: body.model ?? req.model, latencyMs: elapsed(), usage };
    } catch {
      return { status: "error", reason: "parse", model: req.model, latencyMs: elapsed(), usage };
    }
  } catch (err) {
    const timeout = err instanceof Error && err.name === "AbortError";
    return { status: "error", reason: timeout ? "timeout" : "http", model: req.model, latencyMs: elapsed(), usage: none };
  } finally {
    clearTimeout(timer);
  }
}

/** Some models wrap JSON in ``` fences even when asked not to. */
function stripFences(s: string): string {
  const m = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1]! : s.trim();
}
