import { buildServer } from "./server.js";
import { loadAIConfig } from "./ai-gateway.js";
import { parseTrustProxy } from "./proxy.js";
import { loadReceiptSigner } from "./receipt-key.js";

const ai = loadAIConfig();
const corsOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
const aiDailyCallLimit = Number(process.env.AI_DAILY_CALL_LIMIT ?? 300);
if (!Number.isInteger(aiDailyCallLimit) || aiDailyCallLimit < 0) throw new Error("AI_DAILY_CALL_LIMIT must be a non-negative integer");
const aiDailyTokenBudget = Number(process.env.AI_DAILY_TOKEN_BUDGET ?? 150_000);
if (!Number.isInteger(aiDailyTokenBudget) || aiDailyTokenBudget < 0) throw new Error("AI_DAILY_TOKEN_BUDGET must be a non-negative integer");
const aiDailyBudgetUsd = Number(process.env.AI_DAILY_BUDGET_USD ?? 0.25);
if (!Number.isFinite(aiDailyBudgetUsd) || aiDailyBudgetUsd < 0) throw new Error("AI_DAILY_BUDGET_USD must be a non-negative number");
const aiPerClientDailyCalls = Number(process.env.AI_PER_CLIENT_DAILY_CALLS ?? 40);
if (!Number.isInteger(aiPerClientDailyCalls) || aiPerClientDailyCalls < 0) throw new Error("AI_PER_CLIENT_DAILY_CALLS must be a non-negative integer");
const { signer, retired } = loadReceiptSigner();
const app = await buildServer({ ai, logger: true, corsOrigins, trustProxy, aiDailyCallLimit, aiDailyTokenBudget, aiDailyBudgetUsd, aiPerClientDailyCalls, signer, retiredKeys: retired });
const port = Number(process.env.PORT ?? 8080);
// Loopback by default: on shared Wi-Fi (a hackathon venue) 0.0.0.0 would let anyone
// on the network spend the AI budget and mint receipts. Containers set HOST=0.0.0.0.
const host = process.env.HOST?.trim() || "127.0.0.1";
await app.listen({ port, host });
app.log.info({ ai: ai ? { routing: ai.routing } : "disabled", trustProxy, aiDailyCallLimit, aiDailyTokenBudget, aiDailyBudgetUsd, aiPerClientDailyCalls, host, receiptKid: signer.kid }, "rights api ready");
