import { buildServer } from "./server.js";
import { loadAIConfig } from "./ai-gateway.js";

const ai = loadAIConfig();
const corsOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const app = await buildServer({ ai, logger: true, corsOrigins });
const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: "0.0.0.0" });
app.log.info({ ai: ai ? { model: ai.model } : "disabled" }, "rights api ready");
