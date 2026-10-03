import { buildServer } from "./server.js";
import { loadAIConfig } from "./ai-gateway.js";
import { parseTrustProxy } from "./proxy.js";
import { loadReceiptSigner } from "./receipt-key.js";

const ai = loadAIConfig();
const corsOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
const aiDailyCallLimit = Number(process.env.AI_DAILY_CALL_LIMIT ?? 500);
if (!Number.isInteger(aiDailyCallLimit) || aiDailyCallLimit < 0) throw new Error("AI_DAILY_CALL_LIMIT must be a non-negative integer");
const { signer, retired } = loadReceiptSigner();
const app = await buildServer({ ai, logger: true, corsOrigins, trustProxy, aiDailyCallLimit, signer, retiredKeys: retired });
const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: "0.0.0.0" });
app.log.info({ ai: ai ? { model: ai.model } : "disabled", trustProxy, aiDailyCallLimit, receiptKid: signer.kid }, "rights api ready");
