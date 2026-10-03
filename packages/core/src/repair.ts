import type { UseRequest } from "./schemas.js";

/**
 * Make a reading internally consistent — only ever in the cautious direction.
 * Every rule can only turn a permission flag ON (which the engine can deny),
 * never off, so a repair can't make anything more likely to be ALLOWED.
 */
export interface Repaired {
  request: UseRequest;
  /** What was changed, for the trace. Never contains request text. */
  repairs: string[];
}

export function repairReading(r: UseRequest): Repaired {
  const out: UseRequest = { ...r };
  const repairs: string[] = [];
  const set = (k: "commercial" | "aiTraining" | "aiGeneration" | "likeness" | "sublicensing", why: string) => {
    if (!out[k]) {
      out[k] = true;
      repairs.push(why);
    }
  };
  if (r.useType === "ai_training") set("aiTraining", "ai_training use implies aiTraining");
  if (r.useType === "ai_generation" || r.useType === "voice_cloning" || r.useType === "face_replication")
    set("aiGeneration", `${r.useType} use implies aiGeneration`);
  if (r.useType === "voice_cloning" || r.useType === "face_replication") set("likeness", `${r.useType} use implies likeness`);
  if (r.useType === "sublicensing") set("sublicensing", "sublicensing use implies sublicensing");
  if (r.useType === "advertising" || r.useType === "merchandising") set("commercial", `${r.useType} use implies commercial`);
  if (r.media.includes("advertising") || r.media.includes("merchandise")) set("commercial", "advertising or merchandise channel implies commercial");
  return { request: out, repairs };
}
