/**
 * Picks the cheapest model that does each tier's work correctly, and (with
 * --write) records it in agent/etc/models.json.
 *
 *   npm run models:route              dry run: benchmark and report
 *   npm run models:route -- --write   also rewrite agent/etc/models.json
 *
 * How:
 *  1. Live prices and model ids come from Nebius /v1/models (free call).
 *  2. light    = cheapest model that gets EVERY fast-path eval case right (classify, no reasoning).
 *     standard = cheapest model that gets EVERY deep-path eval case right (plan, reasoning on).
 *     heavy    = the most capable (priciest) model; not benchmarked, to save credit.
 *  3. Candidates are tried cheapest first and the search stops at the first pass,
 *     so the expensive models are only called when the cheap ones fail.
 * Credit guard: hard cap ROUTE_USD_CAP (default $0.05) across the whole run.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeForScan, RightsPolicy } from "@nextplay/core";
import { loadAIConfig } from "./ai-gateway.js";
import { DailyBudget } from "./agent/budget.js";
import { loadAgentHome, type AgentHome, type Tier } from "./agent/home.js";
import { runAgent } from "./agent/runtime.js";

const write = process.argv.includes("--write");
const ai = loadAIConfig();
if (!ai) {
  console.error("Set NEBIUS_BASE_URL and NEBIUS_API_KEY first.");
  process.exit(1);
}
const home = loadAgentHome();
const usdCap = Number(process.env.ROUTE_USD_CAP ?? 0.05);
const budget = new DailyBudget(0, 0, usdCap);

// 1. Live catalog and prices.
const res = await fetch(`${ai.baseUrl}/models?verbose=true`, { headers: { authorization: `Bearer ${ai.apiKey}` } });
if (!res.ok) {
  console.error(`Model list failed: HTTP ${res.status}`);
  process.exit(1);
}
type Listed = { id: string; pricing?: { prompt?: string; completion?: string } };
const listed = ((await res.json()) as { data: Listed[] }).data
  .filter((m) => /nemotron/i.test(m.id) && m.pricing?.prompt !== undefined)
  .map((m) => ({ id: m.id, inputPerM: Number(m.pricing!.prompt) * 1e6, outputPerM: Number(m.pricing!.completion) * 1e6 }))
  .filter((m) => Number.isFinite(m.inputPerM) && Number.isFinite(m.outputPerM))
  // Blended price for this workload (prompts are ~4x longer than answers).
  .sort((a, b) => a.inputPerM * 4 + a.outputPerM - (b.inputPerM * 4 + b.outputPerM) || a.id.localeCompare(b.id));
console.log("Candidates (cheapest first, $/1M in/out):");
for (const m of listed) console.log(`  ${m.id.padEnd(42)} ${m.inputPerM.toFixed(2)} / ${m.outputPerM.toFixed(2)}`);

// 2. Split the eval corpus by the path triage would send it down.
const dir = join(import.meta.dirname, "../../../evals/rights-analysis");
const cases = await Promise.all(
  (await readdir(dir)).filter((f) => f.endsWith(".json")).sort().map(async (f) => ({ f, ...JSON.parse(await readFile(join(dir, f), "utf8")) })),
);
const deepCase = (text: string) => home.triage.some((re) => re.test(normalizeForScan(text)));
const fast = cases.filter((c) => !deepCase(c.requestText));
const deep = cases.filter((c) => deepCase(c.requestText));

/** A home that sends every call of `phase` to `model`, with no escalation, so a miss is visible. */
function pinned(model: { id: string; inputPerM: number; outputPerM: number }): AgentHome {
  const spec = { model: model.id, inputPerM: model.inputPerM, outputPerM: model.outputPerM };
  return {
    ...home,
    config: { ...home.config, loop: { ...home.config.loop, maxIterations: 1 } },
    models: {
      ...home.models,
      tiers: { light: spec, standard: spec, heavy: spec },
      routing: { ...home.models.routing, heavyEnabled: false, escalateOnFailure: false },
    },
  };
}

async function passes(model: (typeof listed)[number], set: typeof cases, label: string): Promise<boolean | "budget"> {
  const h = pinned(model);
  let ok = 0;
  let usd = 0;
  for (const c of set) {
    const out = await runAgent({ home: h, ai: { ...ai!, routing: "auto" }, budget }, RightsPolicy.parse(c.policy), c.requestText);
    if (out.kind === "budget") return "budget";
    const decision = out.kind === "ok" ? out.evaluation.decision : "NEEDS_REVIEW";
    const good = (c.acceptable as string[]).includes(decision);
    if ("trace" in out) usd += out.trace.usd;
    if (good) ok++;
    else console.log(`      miss ${c.f} → ${decision}${out.kind === "error" ? ` (${out.reason})` : ""}`);
  }
  console.log(`    ${label} ${model.id}: ${ok}/${set.length}  $${usd.toFixed(6)}`);
  return ok === set.length;
}

async function cheapestPassing(set: typeof cases, label: string) {
  console.log(`\n${label}: ${set.length} cases`);
  for (const m of listed) {
    const r = await passes(m, set, label);
    if (r === "budget") {
      console.log(`    stopped: ROUTE_USD_CAP $${usdCap} reached`);
      return null;
    }
    if (r) return m;
  }
  return null;
}

const light = await cheapestPassing(fast, "light (classify)");
const standard = await cheapestPassing(deep, "standard (plan)");
const heavy = listed.at(-1) ?? null;
console.log(`\nSpent this run: $${budget.snapshot().usd.toFixed(6)} (cap $${usdCap})`);

// 3. Report and optionally write.
const choice: Record<Tier, (typeof listed)[number] | null> = { light, standard, heavy };
for (const t of ["light", "standard", "heavy"] as const) {
  const c = choice[t];
  console.log(`${t.padEnd(9)} → ${c ? c.id : `(no passing model; keeping ${home.models.tiers[t].model})`}`);
}
if (!write) {
  console.log("\nDry run. Re-run with -- --write to update agent/etc/models.json.");
  process.exit(0);
}
const file = join(home.root, "etc/models.json");
const current = JSON.parse(await readFile(file, "utf8"));
for (const t of ["light", "standard", "heavy"] as const) {
  const c = choice[t];
  if (c) current.tiers[t] = { model: c.id, inputPerM: Number(c.inputPerM.toFixed(4)), outputPerM: Number(c.outputPerM.toFixed(4)) };
}
current.note = `Prices are USD per 1M tokens from Nebius /v1/models. Chosen by npm run models:route on ${new Date().toISOString().slice(0, 10)}.`;
await writeFile(file, JSON.stringify(current, null, 2) + "\n");
loadAgentHome(); // validate what was written; throws if invalid
console.log(`Wrote ${file}`);
