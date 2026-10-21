/**
 * AI eval runner: sends each fixture through the full agent loop and checks the
 * FINAL engine decision (not the model's opinion) against the expected one.
 * Prints the path (fast/deep), loop steps and billed tokens per case.
 *   NEBIUS_* env set → npm run eval
 * Credit guard: one run is capped at EVAL_TOKEN_CAP tokens (default 25,000).
 * EVAL_ONLY=10,11 runs only the matching fixtures.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { RightsPolicy } from "@nextplay/core";
import { loadAIConfig } from "./ai-gateway.js";
import { DailyBudget } from "./agent/budget.js";
import { loadAgentHome } from "./agent/home.js";
import { runAgent } from "./agent/runtime.js";

const dir = join(import.meta.dirname, "../../../evals/rights-analysis");
const ai = loadAIConfig();
if (!ai) {
  console.error("Set NEBIUS_BASE_URL, NEBIUS_MODEL, NEBIUS_API_KEY to run evals.");
  process.exit(1);
}
const ctx = { home: loadAgentHome(), ai, budget: new DailyBudget(0, Number(process.env.EVAL_TOKEN_CAP ?? 25_000), Number(process.env.EVAL_USD_CAP ?? 0.05)) };
// EVAL_ONLY=10,11 runs just those cases (saves credit while iterating).
const only = (process.env.EVAL_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const files = (await readdir(dir))
  .filter((f) => f.endsWith(".json") && (only.length === 0 || only.some((p) => f.startsWith(p))))
  .sort();
let pass = 0;
const total = { prompt: 0, completion: 0, reasoning: 0, calls: 0, usd: 0 };
for (const f of files) {
  const fx = JSON.parse(await readFile(join(dir, f), "utf8"));
  const out = await runAgent(ctx, RightsPolicy.parse(fx.policy), fx.requestText);
  const decision = out.kind === "ok" ? out.evaluation.decision : "NEEDS_REVIEW";
  const ok = (fx.acceptable as string[]).includes(decision);
  if (ok) pass++;
  const t = "trace" in out ? out.trace : null;
  if (t) {
    total.prompt += t.tokens.prompt;
    total.completion += t.tokens.completion;
    total.reasoning += t.tokens.reasoning;
    total.calls += t.modelCalls;
    total.usd += t.usd;
  }
  const how = out.kind === "ok" || out.kind === "error"
    ? `${out.trace.path}${out.trace.escalated ? "→deep" : ""} [${out.trace.calls.map((c) => `${c.phase}:${c.tier}${c.ok ? "" : "✗"}`).join(" ")}] tokens ${out.trace.tokens.prompt}+${out.trace.tokens.completion} (r ${out.trace.tokens.reasoning}) $${out.trace.usd.toFixed(6)}`
    : out.kind;
  console.log(`${ok ? "PASS" : "FAIL"}  ${f.padEnd(34)} → ${decision.padEnd(12)} ${how}`);
  if (!ok) {
    if (out.kind === "error") console.log(`      AI error: ${out.reason}`);
    if (out.kind === "ok") {
      console.log(`      denials ${JSON.stringify(out.evaluation.denials)} reviews ${JSON.stringify(out.evaluation.reviews)}`);
      console.log(`      readings ${JSON.stringify(out.trace.readingDecisions)} terms ${JSON.stringify(out.request)}`);
    }
  }
}
console.log(`\n${pass}/${files.length} passed`);
console.log(`tokens: prompt ${total.prompt}, completion ${total.completion} (reasoning ${total.reasoning}) over ${total.calls} model calls — $${total.usd.toFixed(6)}`);
process.exit(pass === files.length ? 0 : 1);
