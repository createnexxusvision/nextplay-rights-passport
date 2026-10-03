import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import { z } from "zod";
import {
  commit,
  evaluate,
  RightsPolicy,
  UseRequest,
  verifyOpening,
  canonicalize,
  type Evaluation,
  type PublicKeyEntry,
  type ReceiptBasis,
  type ReceiptSigner,
} from "@nextplay/core";
import type { AIConfig } from "./ai-gateway.js";
import { DailyBudget } from "./agent/budget.js";
import { loadAgentHome, type AgentHome } from "./agent/home.js";
import { runAgent, type AgentContext } from "./agent/runtime.js";
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
  /** Global cap on billed model tokens per UTC day (Nebius credit ceiling). 0 or undefined = unlimited (dev only). */
  aiDailyTokenBudget?: number;
  /** The agent's home (agent/). Default: loaded from the repo's agent/ directory. */
  agentHome?: AgentHome;
  /** Signs decision receipts (C2). Without it, no receipts are issued. */
  signer?: ReceiptSigner;
  /** Rotated-out public keys still published so old receipts verify. */
  retiredKeys?: PublicKeyEntry[];
  now?: () => Date;
}

const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
/**
 * Opening of the caller's policy seal. Lets the API bind a receipt to the
 * sealed commitment. The server already sees the policy plaintext; the salt is
 * used once to check the seal and is never logged or stored.
 */
const PolicySeal = z.object({ commitment: Hex32, salt: Hex32 }).strict();
const AnalyzeBody = z.object({ policy: RightsPolicy, requestText: z.string().trim().min(1).max(4000).transform((s) => s.normalize("NFC")), policySeal: PolicySeal.optional() }).strict();
const EvaluateBody = z.object({ policy: RightsPolicy, request: UseRequest, policySeal: PolicySeal.optional() }).strict();

/** Fallback the client shows whenever the AI path can't answer. */
const FORM_FALLBACK = "Automatic extraction unavailable. Use the structured request form.";

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const trustProxy = deps.trustProxy ?? "none";
  const agent: AgentContext = {
    home: deps.agentHome ?? loadAgentHome(),
    ai: deps.ai,
    budget: new DailyBudget(deps.aiDailyCallLimit ?? 0, deps.aiDailyTokenBudget ?? 0, deps.now ?? (() => new Date())),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  };

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

  /** Whether the seal opening matches the policy that was sent. */
  async function sealMatches(policy: RightsPolicy, seal: z.infer<typeof PolicySeal>): Promise<boolean> {
    return verifyOpening(
      { domain: "rights-policy", version: 1, commitment: seal.commitment },
      { salt: seal.salt, canonical: canonicalize(policy) },
    );
  }

  /** C2: sign what the engine decided, bound to the sealed policy and a salted request commitment. */
  async function issueReceipt(
    seal: z.infer<typeof PolicySeal> | undefined,
    evaluation: Evaluation,
    request: UseRequest,
    basis: ReceiptBasis,
    model: string | null,
  ) {
    if (!deps.signer || !seal) return {};
    const { commitment, opening } = await commit("use-request", request);
    const signed = deps.signer.sign(
      {
        policyCommitment: seal.commitment.toLowerCase(),
        policyVersion: evaluation.policyVersion,
        requestCommitment: commitment.commitment,
        decision: evaluation.decision,
        denials: evaluation.denials,
        reviews: evaluation.reviews,
        engineVersion: evaluation.engineVersion,
        model,
        basis,
      },
      deps.now?.(),
    );
    // The opening goes only to this caller; it is what lets them later prove which request was decided.
    return { receipt: signed, requestOpening: opening };
  }

  app.get("/health", async () => ({ status: "ok", service: "nextplay-rights-api", ai: deps.ai ? "enabled" : "disabled" }));

  /** C2: public keys for verifying decision receipts. */
  app.get("/api/v1/keys", async () => ({
    keys: [...(deps.signer ? [deps.signer.publicKey] : []), ...(deps.retiredKeys ?? [])],
  }));

  /** Deterministic only — works with AI fully disabled. */
  app.post("/api/v1/rights/evaluate", async (req, reply) => {
    const parsed = EvaluateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const { policy, request, policySeal } = parsed.data;
    if (policySeal && !(await sealMatches(policy, policySeal))) return reply.code(400).send({ error: "policy_seal_mismatch" });
    const evaluation = evaluate(policy, request);
    return {
      evaluation,
      basis: "structured_terms",
      ai: { status: "not_used" },
      ...(await issueReceipt(policySeal, evaluation, request, "structured_terms", null)),
    };
  });

  /** Natural-language request → Nemotron extraction → engine decision. */
  app.post("/api/v1/rights/analyze", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = AnalyzeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    const { policy, requestText, policySeal } = parsed.data;
    if (policySeal && !(await sealMatches(policy, policySeal))) return reply.code(400).send({ error: "policy_seal_mismatch" });

    // The agent loop: prescan → facts → triage → classify|plan → repair → evaluate → verify → explain.
    const out = await runAgent(agent, policy, requestText);

    if (out.kind === "injection") {
      // S1: deterministic tripwire before the model sees anything. A hit never reaches the AI.
      req.log.warn({ injection: out.matches }, "injection pre-scan hit");
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
    if (out.kind === "budget") {
      // S2 + credit ceiling: daily call or token budget used up.
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
    if (out.kind !== "ok") {
      // Degrade to manual review — never fabricate certainty.
      return {
        evaluation: null,
        decision: "NEEDS_REVIEW",
        reviews: ["ai_unavailable"],
        ai: out.kind === "disabled" ? { status: "disabled" } : { status: "error", reason: out.reason, model: out.model },
        ...(out.kind === "error" ? { agent: out.trace } : {}),
        fallback: "structured_form",
        humanReviewRequired: true,
        advisory: FORM_FALLBACK,
      };
    }
    const { evaluation, request } = out;
    req.log.info({ agent: { path: out.trace.path, calls: out.trace.modelCalls, tokens: out.trace.tokens } }, "agent done");
    return {
      evaluation,
      decision: evaluation.decision,
      // S1: an AI-derived decision only covers the terms the AI extracted, never the prose.
      // ALLOWED is provisional until the requester confirms these exact terms via /evaluate.
      basis: "ai_extraction",
      extractedRequest: request,
      confirmation: evaluation.decision === "ALLOWED"
        ? { required: true, terms: request, endpoint: "/api/v1/rights/evaluate" }
        : { required: false },
      ai: {
        status: "ok",
        model: out.model,
        latencyMs: out.latencyMs,
        confidence: out.confidence,
        missingInformation: out.missingInformation,
        ambiguities: [],
        explanation: out.explanation,
      },
      // How the agent got there: path, loop steps, readings, tokens. Never contains request text.
      agent: out.trace,
      humanReviewRequired: evaluation.decision !== "ALLOWED",
      ...(await issueReceipt(policySeal, evaluation, request, "ai_extraction", out.model)),
      advisory: "AI output is advisory. The decision comes from the deterministic policy engine, not the model, and covers only the extracted terms shown.",
    };
  });

  return app;
}
