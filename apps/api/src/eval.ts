/**
 * AI eval runner: sends each fixture to the live model and checks the FINAL
 * engine decision (not the model's opinion) against the expected one.
 *   NEBIUS_* env set → npm run eval
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { applyAIGate, evaluate, RightsPolicy, scanForInjection } from "@nextplay/core";
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
  // Same order as the API: the deterministic pre-scan runs before the model.
  const ai = scanForInjection(fx.requestText).suspected
    ? null
    : await extractUseRequest(cfg, { policy, requestText: fx.requestText });
  const decision =
    ai?.status === "ok" ? applyAIGate(evaluate(policy, ai.extraction.request), ai.extraction).decision : "NEEDS_REVIEW";
  const ok = (fx.acceptable as string[]).includes(decision);
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${f}  → ${decision}  (expected ${fx.acceptable.join("|")})`);
  if (!ok) {
    // Show why, so a model error isn't mistaken for a real review.
    if (ai === null) console.log("      injection pre-scan hit");
    else if (ai.status !== "ok") console.log(`      AI ${ai.status}${"reason" in ai ? `: ${ai.reason}` : ""}`);
    else {
      const ev = applyAIGate(evaluate(policy, ai.extraction.request), ai.extraction);
      console.log(`      denials ${JSON.stringify(ev.denials)} reviews ${JSON.stringify(ev.reviews)}`);
      console.log(`      extracted ${JSON.stringify(ai.extraction.request)}`);
      console.log(`      missing ${JSON.stringify(ai.extraction.missingInformation)}`);
    }
  }
}
console.log(`\n${pass}/${files.length} passed`);
process.exit(pass === files.length ? 0 : 1);
