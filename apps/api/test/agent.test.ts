import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { RightsPolicy } from "@nextplay/core";
import { DailyBudget } from "../src/agent/budget.js";
import { DEFAULT_AGENT_HOME, loadAgentHome } from "../src/agent/home.js";
import { runAgent } from "../src/agent/runtime.js";
import { buildServer } from "../src/server.js";
import { fakeNebius } from "./fake-nebius.js";

const home = loadAgentHome();
const ai = { baseUrl: "https://example.invalid/v1", model: "nemotron-test", apiKey: "k", timeoutMs: 1000, reasoning: "auto" as const, routing: "auto" as const };
const policy = RightsPolicy.parse({
  version: 1, territory: ["US"], media: ["social", "web", "advertising"], durationDays: 90, commercialUse: false,
  aiTraining: false, aiGeneration: false, likenessUse: false, sublicensing: false, attributionRequired: true,
});
const reading = (patch: Record<string, unknown> = {}) => ({
  useType: "social", media: ["social"], territory: ["US"], commercial: false, aiTraining: false,
  aiGeneration: false, likeness: false, sublicensing: false, ...patch,
});
const ctx = (f: typeof fetch, budget = new DailyBudget(0, 0)) => ({ home, ai, budget, fetchImpl: f });
const CLEAR = "Repost the clip on Instagram in the US for 30 days.";
const JUDGEMENT = "Our sponsor wants to repost the clip on Instagram in the US for 30 days.";

describe("agent home (agent/)", () => {
  it("loads every tool, skill, context file and data table", () => {
    expect(Object.keys(home.tools).sort()).toEqual(
      ["classify", "evaluate", "explain", "facts", "plan", "prescan", "repair", "triage", "verify"],
    );
    expect(home.prompts.plan).toContain("Field rules:");
    expect(home.prompts.classify).toContain("Field rules:");
    // boundary.md is for the runtime and humans; it is never sent to the model.
    expect(home.prompts.plan).not.toContain("# Boundary");
    expect(home.facts.channels.length).toBe(8);
  });

  const tmp = mkdtempSync(join(tmpdir(), "agent-home-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const copy = (name: string) => {
    const dir = join(tmp, name);
    cpSync(DEFAULT_AGENT_HOME, dir, { recursive: true });
    return dir;
  };
  const editConfig = (dir: string, edit: (c: any) => void) => {
    const p = join(dir, "etc/agent.json");
    const c = JSON.parse(readFileSync(p, "utf8"));
    edit(c);
    writeFileSync(p, JSON.stringify(c));
  };

  it("refuses a reordered pipeline (prescan must stay first)", () => {
    const dir = copy("reorder");
    editConfig(dir, (c) => c.pipeline.reverse());
    expect(() => loadAgentHome(dir)).toThrow(/pipeline must be/);
  });
  it("refuses config that points outside the tree", () => {
    const dir = copy("escape");
    editConfig(dir, (c) => (c.phases.plan.skill = "../../etc/passwd"));
    expect(() => loadAgentHome(dir)).toThrow(/invalid/);
  });
  it("refuses unsafe budgets and bad data", () => {
    const dir = copy("budget");
    editConfig(dir, (c) => (c.phases.plan.maxTokens = 100000));
    expect(() => loadAgentHome(dir)).toThrow(/invalid/);
    const dir2 = copy("data");
    writeFileSync(join(dir2, "share/data/channels.json"), JSON.stringify({ channels: { hologram: "x" } }));
    expect(() => loadAgentHome(dir2)).toThrow(/channels.json/);
  });
});

describe("agent loop", () => {
  it("fast path: a clear request costs one call with reasoning off", async () => {
    const fake = fakeNebius({ readings: [reading()], confidence: 0.95 });
    const out = await runAgent(ctx(fake.f), policy, CLEAR);
    expect(fake.calls.map((c) => c.phase)).toEqual(["classify"]);
    expect(fake.calls[0]!.body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(out).toMatchObject({ kind: "ok", evaluation: { decision: "ALLOWED" }, trace: { path: "fast", modelCalls: 1, escalated: false } });
    if (out.kind === "ok") expect(out.trace.steps).toEqual(["prescan", "facts", "triage:fast", "classify", "repair", "evaluate", "verify", "explain"]);
  });

  it("deep path: a judgement call plans with reasoning on", async () => {
    const fake = fakeNebius({ readings: [reading({ commercial: true })], confidence: 0.9 });
    const out = await runAgent(ctx(fake.f), policy, JUDGEMENT);
    expect(fake.calls.map((c) => c.phase)).toEqual(["plan"]);
    expect(fake.calls[0]!.body.chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(fake.calls[0]!.body.reasoning_effort).toBe("low");
    expect(out).toMatchObject({ kind: "ok", evaluation: { decision: "DENIED", denials: ["commercial_use_not_authorized"] }, trace: { path: "deep" } });
  });

  it("AI_REASONING=off forces reasoning off even on the deep path", async () => {
    const fake = fakeNebius({ readings: [reading()], confidence: 0.9 });
    await runAgent({ ...ctx(fake.f), ai: { ...ai, reasoning: "off" } }, policy, JUDGEMENT);
    expect(fake.calls[0]!.body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(fake.calls[0]!.body.reasoning_effort).toBeUndefined();
  });

  it("an unsure fast pass loops back once to plan, and the plan's judgement is used", async () => {
    const fake = fakeNebius((phase) =>
      phase === "classify" ? { readings: [reading()], confidence: 0.5 } : { readings: [reading({ commercial: true })], confidence: 0.9 },
    );
    const out = await runAgent(ctx(fake.f), policy, CLEAR);
    expect(fake.calls.map((c) => c.phase)).toEqual(["classify", "plan"]);
    expect(out).toMatchObject({ kind: "ok", evaluation: { decision: "DENIED" }, trace: { escalated: true, modelCalls: 2 } });
  });

  it("a repaired fast pass escalates; repairs only ever add caution", async () => {
    const fake = fakeNebius((phase) =>
      phase === "classify"
        ? { readings: [reading({ useType: "advertising", media: [] })], confidence: 0.95 }
        : { readings: [reading({ useType: "advertising", commercial: true })], confidence: 0.95 },
    );
    const out = await runAgent(ctx(fake.f), policy, "Put the clip on our website in the US for 30 days.");
    expect(fake.calls.map((c) => c.phase)).toEqual(["classify", "plan"]);
    expect(out.kind === "ok" && out.request.commercial).toBe(true);
  });

  it("readings that lead to different decisions go to a person", async () => {
    const fake = fakeNebius({ readings: [reading(), reading({ commercial: true })], confidence: 0.9 });
    const out = await runAgent(ctx(fake.f), policy, JUDGEMENT);
    expect(out).toMatchObject({ kind: "ok", evaluation: { decision: "NEEDS_REVIEW" }, trace: { readings: 2, readingDecisions: ["ALLOWED", "DENIED"] } });
    if (out.kind === "ok") expect(out.evaluation.reviews).toContain("ai_readings_disagree");
  });

  it("a denied first reading stays denied when another reading disagrees", async () => {
    const fake = fakeNebius({ readings: [reading({ commercial: true }), reading()], confidence: 0.9 });
    const out = await runAgent(ctx(fake.f), policy, JUDGEMENT);
    expect(out).toMatchObject({ kind: "ok", evaluation: { decision: "DENIED" } });
  });

  it("never exceeds maxIterations model calls", async () => {
    const fake = fakeNebius({ readings: [reading()], confidence: 0.1 });
    const out = await runAgent(ctx(fake.f), policy, CLEAR);
    expect(fake.calls.length).toBe(home.config.loop.maxIterations);
    expect(out).toMatchObject({ kind: "ok", evaluation: { decision: "NEEDS_REVIEW", reviews: ["ai_low_confidence"] } });
  });

  it("the policy never reaches the model, in any phase", async () => {
    const fake = fakeNebius((phase) => ({ readings: [reading()], confidence: phase === "classify" ? 0.5 : 0.9 }));
    await runAgent(ctx(fake.f), policy, CLEAR);
    for (const c of fake.calls) {
      expect(JSON.stringify(c.body)).not.toMatch(/commercialUse|attributionRequired|likenessUse|"version"/);
      expect(Object.keys(JSON.parse(c.body.messages[1].content))).toEqual(["requestText"]);
    }
  });
});

describe("token budget (credit ceiling)", () => {
  it("skips the deep pass when it won't fit, keeping the cautious fast result", async () => {
    const fake = fakeNebius({ readings: [reading()], confidence: 0.5 });
    const out = await runAgent(ctx(fake.f, new DailyBudget(0, 1200)), policy, CLEAR);
    expect(fake.calls.map((c) => c.phase)).toEqual(["classify"]);
    expect(out).toMatchObject({ kind: "ok", evaluation: { decision: "NEEDS_REVIEW" } });
    if (out.kind === "ok") expect(out.trace.steps).toContain("plan:skipped-budget");
  });

  it("returns 503 with the form fallback once billed tokens use up the day", async () => {
    const fake = fakeNebius({ readings: [reading()], confidence: 0.95 });
    const app = await buildServer({ ai, fetchImpl: fake.f, aiDailyTokenBudget: 1100 });
    const send = () => app.inject({ method: "POST", url: "/api/v1/rights/analyze", payload: { policy, requestText: CLEAR } });
    // Reserve = used + phase maxTokens (256) + prompt allowance (600).
    expect((await send()).statusCode).toBe(200); // 0 + 856 fits; 310 billed
    expect((await send()).statusCode).toBe(503); // 310 + 856 = 1166 > 1100
    expect(fake.calls.length).toBe(1);
  });

  it("counts billed tokens, including reasoning", () => {
    const b = new DailyBudget(0, 10_000);
    b.spend(310);
    b.spend(610);
    expect(b.snapshot().tokens).toBe(920);
  });
});

describe("model routing (agent/etc/models.json)", () => {
  const tiers = home.models.tiers;
  const HEAVY = "Our sponsor wants an AI-generated ad with the athlete's face and voice, then to share with partners for training their model. US, 60 days, $5,000.";

  it("routine work goes to the light model, judgement to the standard model", async () => {
    const fast = fakeNebius({ readings: [reading()], confidence: 0.95 });
    await runAgent(ctx(fast.f), policy, CLEAR);
    expect(fast.calls[0]!.body.model).toBe(tiers.light.model);
    const deep = fakeNebius({ readings: [reading()], confidence: 0.95 });
    await runAgent(ctx(deep.f), policy, JUDGEMENT);
    expect(deep.calls[0]!.body.model).toBe(tiers.standard.model);
  });

  it("a heavy workload goes to the heavy model", async () => {
    const fake = fakeNebius({ readings: [reading()], confidence: 0.95 });
    const out = await runAgent(ctx(fake.f), policy, HEAVY);
    expect(fake.calls[0]!.body.model).toBe(tiers.heavy.model);
    expect(out.kind === "ok" && out.trace.workload).toBeGreaterThanOrEqual(home.models.routing.heavyAtWorkload);
  });

  it("heavy is refused when today's dollars can't cover it; standard does the work instead", async () => {
    const fake = fakeNebius({ readings: [reading()], confidence: 0.95 });
    // Standard worst case ≈ (600×0.30 + 1536×0.90)/1e6 ≈ $0.0016; heavy ≈ $0.0052.
    await runAgent(ctx(fake.f, new DailyBudget(0, 0, 0.003)), policy, HEAVY);
    expect(fake.calls[0]!.body.model).toBe(tiers.standard.model);
  });

  it("an unsure light answer is re-done by a bigger model, never the same one", async () => {
    const fake = fakeNebius((phase) => ({ readings: [reading()], confidence: phase === "classify" ? 0.4 : 0.95 }));
    const out = await runAgent(ctx(fake.f), policy, CLEAR);
    expect(fake.calls.map((c) => c.body.model)).toEqual([tiers.light.model, tiers.standard.model]);
    expect(out.kind === "ok" && out.trace.calls.map((c) => c.tier)).toEqual(["light", "standard"]);
  });

  it("an unusable light answer is retried one tier up instead of failing", async () => {
    const fake = fakeNebius((phase) => (phase === "classify" ? null : { readings: [reading()], confidence: 0.95 }));
    const out = await runAgent(ctx(fake.f), policy, CLEAR);
    expect(fake.calls.map((c) => c.body.model)).toEqual([tiers.light.model, tiers.standard.model]);
    expect(out).toMatchObject({ kind: "ok", evaluation: { decision: "ALLOWED" } });
    if (out.kind === "ok") expect(out.trace.calls.map((c) => c.ok)).toEqual([false, true]);
  });

  it("records the real cost per call at each tier's price", async () => {
    const fake = fakeNebius({ readings: [reading()], confidence: 0.95 });
    const out = await runAgent(ctx(fake.f), policy, CLEAR);
    // fake bills 250 prompt + 60 completion tokens
    const expected = (250 * tiers.light.inputPerM + 60 * tiers.light.outputPerM) / 1e6;
    expect(out.kind === "ok" && out.trace.usd).toBeCloseTo(expected, 12);
  });

  it("AI_MODEL_ROUTING=off sends every call to NEBIUS_MODEL", async () => {
    const fake = fakeNebius({ readings: [reading()], confidence: 0.95 });
    await runAgent({ ...ctx(fake.f), ai: { ...ai, routing: "off", model: "pinned/model" } }, policy, HEAVY);
    expect(fake.calls.every((c) => c.body.model === "pinned/model")).toBe(true);
  });

  it("refuses an invalid models.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-models-"));
    cpSync(DEFAULT_AGENT_HOME, dir, { recursive: true });
    const p = join(dir, "etc/models.json");
    const m = JSON.parse(readFileSync(p, "utf8"));
    m.routing.classify = "galaxy-brain";
    writeFileSync(p, JSON.stringify(m));
    expect(() => loadAgentHome(dir)).toThrow(/models.json/);
    rmSync(dir, { recursive: true, force: true });
  });
});
