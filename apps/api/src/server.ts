import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import { z } from "zod";
import { applyAIGate, evaluate, RightsPolicy, UseRequest } from "@nextplay/core";
import { extractUseRequest, type AIConfig } from "./ai-gateway.js";

/**
 * Rights API. Responsibilities, in order: validate → (optionally) ask AI to
 * extract → deterministic engine decides → return evidence of how.
 * No persistence and no Midnight calls in this milestone.
 * Request bodies are never logged (they can contain private terms).
 */
export interface ServerDeps {
  ai: AIConfig | null;
  fetchImpl?: typeof fetch;
  logger?: boolean;
  /** Exact browser origins allowed to call the API (e.g. the Cloudflare Pages URL). Empty = same-origin only. */
  corsOrigins?: string[];
}

const AnalyzeBody = z.object({ policy: RightsPolicy, requestText: z.string().trim().min(1).max(4000) }).strict();
const EvaluateBody = z.object({ policy: RightsPolicy, request: UseRequest }).strict();

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 64 * 1024,
    logger: deps.logger
      ? { redact: ["req.headers.authorization", "req.headers.cookie", "req.body"] }
      : false,
  });
  await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });
  await app.register(cors, { origin: deps.corsOrigins?.length ? deps.corsOrigins : false, methods: ["GET", "POST"] });

  app.get("/health", async () => ({ status: "ok", service: "nextplay-rights-api", ai: deps.ai ? "enabled" : "disabled" }));

  /** Deterministic only — works with AI fully disabled. */
  app.post("/api/v1/rights/evaluate", async (req, reply) => {
    const parsed = EvaluateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    return { evaluation: evaluate(parsed.data.policy, parsed.data.request), ai: { status: "not_used" } };
  });

  /** Natural-language request → Nemotron extraction → engine decision. */
  app.post("/api/v1/rights/analyze", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = AnalyzeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const { policy, requestText } = parsed.data;

    const ai = await extractUseRequest(deps.ai, { policy, requestText }, deps.fetchImpl);
    if (ai.status !== "ok") {
      // Degrade to manual review — never fabricate certainty.
      return {
        evaluation: null,
        decision: "NEEDS_REVIEW",
        reviews: ["ai_unavailable"],
        ai: ai.status === "disabled" ? { status: "disabled" } : { status: "error", reason: ai.reason, model: ai.model },
        humanReviewRequired: true,
        advisory: "Automatic extraction unavailable. Use the structured request form.",
      };
    }
    const engine = evaluate(policy, ai.extraction.request);
    const gated = applyAIGate(engine, ai.extraction);
    return {
      evaluation: gated,
      decision: gated.decision,
      extractedRequest: ai.extraction.request,
      ai: {
        status: "ok",
        model: ai.model,
        latencyMs: ai.latencyMs,
        confidence: ai.extraction.confidence,
        missingInformation: ai.extraction.missingInformation,
        ambiguities: ai.extraction.ambiguities,
        explanation: ai.extraction.explanation,
      },
      humanReviewRequired: gated.decision !== "ALLOWED",
      advisory: "AI output is advisory. The decision comes from the deterministic policy engine, not the model.",
    };
  });

  return app;
}
