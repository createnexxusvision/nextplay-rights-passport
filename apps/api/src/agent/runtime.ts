import {
  AIModelOutput,
  AIPlanOutput,
  applyAIGate,
  describeUseRequest,
  evaluate,
  normalizeForScan,
  repairReading,
  scanForInjection,
  UseRequest,
  type Decision,
  type Evaluation,
  type ModelRequest,
  type RightsPolicy,
} from "@nextplay/core";
import { callModel, CLASSIFY_JSON_SCHEMA, planJsonSchema, type AIConfig, type TokenUsage } from "../ai-gateway.js";
import { estimatePromptTokens, type DailyBudget } from "./budget.js";
import { extractRequestFacts, mergeRequest } from "./facts.js";
import type { AgentHome, ModelPhase, Tier } from "./home.js";
import { costUsd, measureWorkload, route } from "./router.js";

/**
 * The rights agent loop. Runs the fixed pipeline from agent/etc/agent.json:
 *
 *   prescan → facts → triage → think (classify | plan) → repair → evaluate → verify → explain
 *                                  ↑__________________ verify: unsure → plan ___|
 *
 * It returns only when it reaches a final decision; nothing partial is emitted.
 * Model phases cost tokens; every other step is code and costs nothing.
 * The engine decides every reading; the model never sees the policy.
 */
export interface AgentContext {
  home: AgentHome;
  ai: AIConfig | null;
  budget: DailyBudget;
  fetchImpl?: typeof fetch;
}

export interface AgentTrace {
  path: "fast" | "deep";
  escalated: boolean;
  steps: string[];
  modelCalls: number;
  readings: number;
  readingDecisions: Decision[];
  repairs: string[];
  tokens: TokenUsage;
  /** Workload score the router used (judgement signals, conflicts, length, prior miss). */
  workload: number;
  /** One entry per model call: which tier and model did which work, and what it cost. */
  calls: Array<{ phase: ModelPhase; tier: Tier; model: string; tokens: TokenUsage; usd: number; ok: boolean }>;
  usd: number;
}

interface ScoredReading {
  request: UseRequest;
  repairs: string[];
  evaluation: Evaluation;
}

export type AgentOutcome =
  | { kind: "injection"; matches: string[] }
  | { kind: "disabled" }
  | { kind: "budget" }
  | { kind: "error"; reason: "timeout" | "http" | "parse" | "truncated" | "schema"; model: string; trace: AgentTrace }
  | {
      kind: "ok";
      evaluation: Evaluation;
      request: UseRequest;
      confidence: number;
      missingInformation: string[];
      explanation: string;
      model: string;
      latencyMs: number;
      trace: AgentTrace;
    };

export async function runAgent(ctx: AgentContext, policy: RightsPolicy, requestText: string): Promise<AgentOutcome> {
  const { home, ai, budget } = ctx;
  const { loop, phases } = home.config;

  // 1 prescan (code): instructions aimed at the AI never reach it.
  const scan = scanForInjection(requestText);
  if (scan.suspected) return { kind: "injection", matches: scan.matches };
  if (!ai) return { kind: "disabled" };

  // 2 facts (code) and 3 triage (code).
  const facts = extractRequestFacts(requestText, home.facts);
  const normalized = normalizeForScan(requestText);
  const deep = home.triage.some((re) => re.test(normalized));
  const trace: AgentTrace = {
    path: deep ? "deep" : "fast",
    escalated: false,
    steps: ["prescan", "facts", `triage:${deep ? "deep" : "fast"}`],
    modelCalls: 0,
    readings: 0,
    readingDecisions: [],
    repairs: [],
    tokens: { prompt: 0, completion: 0, reasoning: 0 },
    workload: 0,
    calls: [],
    usd: 0,
  };
  const load = measureWorkload(home, requestText, facts.conflicts.length);
  let floor: Tier | null = null; // smallest tier that already missed on this request

  let phase: ModelPhase = deep ? "plan" : "classify";
  let best: { phase: ModelPhase; readings: ScoredReading[]; confidence: number; model: string } | null = null;
  let latencyMs = 0;

  while (trace.modelCalls < loop.maxIterations) {
    const p = phases[phase];
    // Route: the cheapest model tier that fits this work (code, zero tokens).
    const promptTokens = estimatePromptTokens(home.prompts[phase], requestText);
    const r = route(home, ai, budget, phase, { ...load, priorMiss: floor !== null }, floor, p.maxTokens, promptTokens);
    trace.workload = r.score;
    // Hard budget: no call starts unless its worst case (real prompt size + max output) fits today's caps.
    if (!budget.tryReserve(p.maxTokens, r.worstCaseUsd, promptTokens, r.tier === "heavy")) {
      if (!best) return { kind: "budget" };
      trace.steps.push(`${phase}:skipped-budget`);
      break;
    }

    // 4 think (model)
    trace.modelCalls++;
    trace.steps.push(phase);
    const call = await callModel(
      ai,
      {
        model: r.model,
        system: home.prompts[phase],
        requestText,
        schema: phase === "plan" ? planJsonSchema(p.maxReadings ?? 3) : CLASSIFY_JSON_SCHEMA,
        reasoning: p.reasoning,
        maxTokens: p.maxTokens,
      },
      ctx.fetchImpl,
    );
    const usd = costUsd(home, r.tier, call.usage.prompt, call.usage.completion);
    budget.spend(call.usage.prompt + call.usage.completion, usd);
    trace.usd += usd;
    trace.tokens.prompt += call.usage.prompt;
    trace.tokens.completion += call.usage.completion;
    trace.tokens.reasoning += call.usage.reasoning;
    latencyMs += call.latencyMs;

    let readings: ModelRequest[] | null = null;
    let confidence = 0;
    if (call.status === "ok") {
      const parsed = phase === "plan" ? AIPlanOutput.safeParse(call.json) : AIModelOutput.safeParse(call.json);
      if (parsed.success) {
        readings = "readings" in parsed.data ? parsed.data.readings : [parsed.data.request];
        confidence = parsed.data.confidence;
      }
    }
    trace.calls.push({ phase, tier: r.tier, model: r.model, tokens: call.usage, usd, ok: readings !== null });
    if (!readings) {
      // A failed deep pass after a good fast pass keeps the fast result (the gate stays cautious).
      if (best) break;
      // A failed cheap call moves UP a tier for the next attempt, never down.
      if (home.models.routing.escalateOnFailure && trace.modelCalls < loop.maxIterations) {
        floor = r.tier;
        trace.escalated = true;
        phase = "plan";
        continue;
      }
      return { kind: "error", reason: call.status === "error" ? call.reason : "schema", model: call.model, trace };
    }

    // 5 repair (code) and 6 evaluate (code, the engine decides each reading).
    const scored: ScoredReading[] = [];
    for (const r of readings) {
      const merged = UseRequest.safeParse(mergeRequest(r, facts));
      if (!merged.success) continue;
      const { request, repairs } = repairReading(merged.data);
      scored.push({ request, repairs, evaluation: evaluate(policy, request) });
    }
    trace.steps.push("repair", "evaluate");
    if (scored.length === 0) {
      if (best) break;
      return { kind: "error", reason: "schema", model: call.model, trace };
    }
    best = { phase, readings: scored, confidence, model: call.model };

    // 7 verify (code): an unsure fast pass gets one deep pass with reasoning.
    trace.steps.push("verify");
    const unsure = confidence < loop.minConfidence || (loop.escalateOnRepair && scored[0]!.repairs.length > 0);
    if (phase === "classify" && unsure && trace.modelCalls < loop.maxIterations) {
      trace.escalated = true;
      floor = r.tier;
      phase = "plan";
      continue;
    }
    break;
  }

  if (!best) return { kind: "budget" };

  // Final verify: readings that lead to different decisions go to a person.
  const primary = best.readings[0]!;
  const decisions = best.readings.map((r) => r.evaluation.decision);
  let ev = primary.evaluation;
  if (new Set(decisions).size > 1) {
    ev = { ...ev, reviews: [...ev.reviews, "ai_readings_disagree"], decision: ev.decision === "DENIED" ? "DENIED" : "NEEDS_REVIEW" };
  }
  const evaluation = applyAIGate(ev, { confidence: best.confidence, missingInformation: facts.conflicts }, loop.minConfidence);

  // 8 explain (code)
  trace.steps.push("explain");
  trace.readings = best.readings.length;
  trace.readingDecisions = decisions;
  trace.repairs = best.readings.flatMap((r) => r.repairs);
  return {
    kind: "ok",
    evaluation,
    request: primary.request,
    confidence: best.confidence,
    missingInformation: facts.conflicts,
    explanation: describeUseRequest(primary.request),
    model: best.model,
    latencyMs,
    trace,
  };
}
