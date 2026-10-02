/**
 * AI eval runner: sends each fixture to the live model and checks the FINAL
 * engine decision (not the model's opinion) against the expected one.
 *   NEBIUS_* env set → npm run eval
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { applyAIGate, evaluate, RightsPolicy } from "@nextplay/core";
import { extractUseRequest, loadAIConfig } from "./ai-gateway.js";

const dir = join(import.meta.dirname, "../../../evals/rights-analysis");
const cfg = loadAIConfig();
if (!cfg) {
  console.error("Set NEBIUS_BASE_URL, NEBIUS_MODEL, NEBIUS_API_KEY to run evals.");
  process.exit(1);
}
let pass = 0;
const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
for (const f of files) {
  const fx = JSON.parse(await readFile(join(dir, f), "utf8"));
  const policy = RightsPolicy.parse(fx.policy);
  const ai = await extractUseRequest(cfg, { policy, requestText: fx.requestText });
  const decision =
    ai.status === "ok" ? applyAIGate(evaluate(policy, ai.extraction.request), ai.extraction).decision : "NEEDS_REVIEW";
  const ok = (fx.acceptable as string[]).includes(decision);
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${f}  → ${decision}  (expected ${fx.acceptable.join("|")})`);
}
console.log(`\n${pass}/${files.length} passed`);
process.exit(pass === files.length ? 0 : 1);
