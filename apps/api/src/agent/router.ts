import { normalizeForScan } from "@nextplay/core";
import type { AIConfig } from "../ai-gateway.js";
import type { DailyBudget } from "./budget.js";
import type { AgentHome, ModelPhase, Tier } from "./home.js";

/**
 * Model router (code, zero tokens). Matches the size of the model to the size
 * of the work, from agent/etc/models.json:
 *   classify (routine reading) → light;  plan (judgement) → standard;
 *   plan on a heavy workload → heavy, if enabled and today's dollars allow.
 * After a failed or unsure call, the next call goes UP a tier, never down.
 */
export interface Workload {
  /** Judgement signals matched in share/data/triage.json. */
  signals: number;
  conflicts: boolean;
  long: boolean;
  /** A cheaper model already failed or was unsure on this request. */
  priorMiss: boolean;
}

export const LONG_TEXT_CHARS = 400;

export function measureWorkload(home: AgentHome, requestText: string, conflicts: number): Omit<Workload, "priorMiss"> {
  const text = normalizeForScan(requestText);
  return {
    signals: home.triage.filter((re) => re.test(text)).length,
    conflicts: conflicts > 0,
    long: text.length > LONG_TEXT_CHARS,
  };
}

export function workloadScore(w: Workload): number {
  return w.signals + (w.conflicts ? 1 : 0) + (w.long ? 1 : 0) + (w.priorMiss ? 1 : 0);
}

const ORDER: Tier[] = ["light", "standard", "heavy"];
const atLeast = (a: Tier, b: Tier): Tier => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);
const next = (t: Tier): Tier => ORDER[Math.min(ORDER.indexOf(t) + 1, ORDER.length - 1)]!;

export interface Route {
  tier: Tier;
  model: string;
  score: number;
  /** Worst-case USD for this call: prompt allowance in, maxTokens out. */
  worstCaseUsd: number;
}

export function costUsd(home: AgentHome, tier: Tier, promptTokens: number, completionTokens: number): number {
  const t = home.models.tiers[tier];
  return (promptTokens * t.inputPerM + completionTokens * t.outputPerM) / 1_000_000;
}

export function route(
  home: AgentHome,
  ai: AIConfig,
  budget: DailyBudget,
  phase: ModelPhase,
  workload: Workload,
  floor: Tier | null,
  maxTokens: number,
  promptAllowance: number,
): Route {
  const r = home.models.routing;
  const score = workloadScore(workload);
  let tier: Tier = r[phase];
  if (phase === "plan" && r.heavyEnabled && score >= r.heavyAtWorkload) tier = "heavy";
  // After a miss, never retry on the same or a smaller model.
  if (floor) tier = atLeast(tier, next(floor));
  // Heavy only if today's heavy cap and dollars still allow it; otherwise drop to standard (never below).
  if (tier === "heavy" && (!budget.heavyAvailable(r.heavyMaxPerDay) || !budget.fitsUsd(costUsd(home, "heavy", promptAllowance, maxTokens)))) {
    tier = "standard";
  }
  const model = ai.routing === "off" ? ai.model : home.models.tiers[tier].model;
  return { tier, model, score, worstCaseUsd: costUsd(home, tier, promptAllowance, maxTokens) };
}
