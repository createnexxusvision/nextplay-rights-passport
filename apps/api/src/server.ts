import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import { z } from "zod";
import { applyAIGate, evaluate, RightsPolicy, scanForInjection, UseRequest } from "@nextplay/core";
import { extractUseRequest, type AIConfig } from "./ai-gateway.js";
import { clientKey, peerAllowed, type TrustProxyMode } from "./proxy.js";

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
  /** How to find the real client IP for rate limiting (S3). Default "none". */
  trustProxy?: TrustProxyMode;
  /** Global cap on model calls per UTC day (S2). 0 or undefined = unlimited (dev only). */
  aiDailyCallLimit?: number;
  now?: () => Date;
}

const AnalyzeBody = z.object({ policy: RightsPolicy, requestText: z.string().trim().min(1).max(4000) }).strict();
const EvaluateBody = z.object({ policy: RightsPolicy, request: UseRequest }).strict();

/** Fallback the client shows whenever the AI path can't answer. */
const FORM_FALLBACK = "Automatic extraction unavailable. Use the structured request form.";

/**
 * Global daily counter for model calls (S2). In-memory: one API instance.
 * Running several replicas multiplies the effective cap — see the security review.
 */
class DailyCounter {
  private day = "";
  private count = 0;
  constructor(private readonly limit: number, private readonly now: () => Date) {}
  tryTake(): boolean {
    if (this.limit <= 0) return true;
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
    }
    if (this.count >= this.limit) return false;
    this.count++;
    return true;
  }
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const trustProxy = deps.trustProxy ?? "none";
  const aiBudget = new DailyCounter(deps.aiDailyCallLimit ?? 0, deps.now ?? (() => new Date()));

  const app = Fastify({
    bodyLimit: 64 * 1024,
    // S4: bound slow-request attacks. The AI call is capped at 25 s, under both limits.
    requestTimeout: 30_000,
    connectionTimeout: 30_000,
    keepAliveTimeout: 5_000,
    logger: deps.logger
      ? { redact: ["req.headers.authorization", "req.headers.cookie", "req.body"] }
      : false,
  });

  // S3: refuse connections that bypass the configured proxy (direct-to-origin traffic).
  app.addHook("onRequest", async (req, reply) => {
    if (!peerAllowed(trustProxy, req.raw.socket.remoteAddress)) {
      return reply.code(403).send({ error: "forbidden" });
    }
  });

  // S5: API responses are private and never cached, sniffed, or leaked via Referer.
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    return payload;
  });

  await app.register(rateLimit, {
    max: 60,
    timeWindow: "1 minute",
    keyGenerator: (req) => clientKey(trustProxy, req.raw.socket.remoteAddress, req.headers),
  });
  await app.register(cors, { origin: deps.corsOrigins?.length ? deps.corsOrigins : false, methods: ["GET", "POST"] });

  app.get("/health", async () => ({ status: "ok", service: "nextplay-rights-api", ai: deps.ai ? "enabled" : "disabled" }));

  /** Deterministic only — works with AI fully disabled. */
  app.post("/api/v1/rights/evaluate", async (req, reply) => {
    const parsed = EvaluateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    return {
      evaluation: evaluate(parsed.data.policy, parsed.data.request),
      basis: "structured_terms",
      ai: { status: "not_used" },
    };
  });

  /** Natural-language request → Nemotron extraction → engine decision. */
  app.post("/api/v1/rights/analyze", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = AnalyzeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const { policy, requestText } = parsed.data;

    // S1: deterministic tripwire before the model sees anything. A hit never reaches the AI.
    const scan = scanForInjection(requestText);
    if (scan.suspected) {
      req.log.warn({ injection: scan.matches }, "injection pre-scan hit");
      return {
        evaluation: null,
        decision: "NEEDS_REVIEW",
        basis: "injection_prescan",
        reviews: ["request_injection_suspected"],
        ai: { status: "not_used" },
        humanReviewRequired: true,
        advisory: "The request text contains instructions aimed at the AI. A person must read it, or use the structured request form.",
      };
    }

    // S2: global spend cap. Checked only when the model would actually be called.
    if (deps.ai && !aiBudget.tryTake()) {
      return reply.code(503).send({
        error: "ai_daily_limit_reached",
        decision: "NEEDS_REVIEW",
        reviews: ["ai_unavailable"],
        ai: { status: "error", reason: "quota" },
        fallback: "structured_form",
        humanReviewRequired: true,
        advisory: FORM_FALLBACK,
      });
    }

    const ai = await extractUseRequest(deps.ai, { policy, requestText }, deps.fetchImpl);
    if (ai.status !== "ok") {
      // Degrade to manual review — never fabricate certainty.
      return {
        evaluation: null,
        decision: "NEEDS_REVIEW",
        reviews: ["ai_unavailable"],
        ai: ai.status === "disabled" ? { status: "disabled" } : { status: "error", reason: ai.reason, model: ai.model },
        fallback: "structured_form",
        humanReviewRequired: true,
        advisory: FORM_FALLBACK,
      };
    }
    const engine = evaluate(policy, ai.extraction.request);
    const gated = applyAIGate(engine, ai.extraction);
    return {
      evaluation: gated,
      decision: gated.decision,
      // S1: an AI-derived decision only covers the terms the AI extracted, never the prose.
      // ALLOWED is provisional until the requester confirms these exact terms via /evaluate.
      basis: "ai_extraction",
      extractedRequest: ai.extraction.request,
      confirmation: gated.decision === "ALLOWED"
        ? { required: true, terms: ai.extraction.request, endpoint: "/api/v1/rights/evaluate" }
        : { required: false },
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
      advisory: "AI output is advisory. The decision comes from the deterministic policy engine, not the model, and covers only the extracted terms shown.",
    };
  });

  return app;
}
