import type { UseRequest } from "./schemas.js";

/**
 * Deterministic plain-language summary of a structured request, for the human
 * reviewer. Replaces model-written prose: same terms → same sentence, no tokens,
 * and it can only ever say what the structured terms say.
 */
const USE: Record<UseRequest["useType"], string> = {
  editorial: "Editorial use",
  social: "Social media use",
  advertising: "Advertising use",
  merchandising: "Merchandising use",
  ai_training: "Use as AI training data",
  ai_generation: "AI-generated content",
  voice_cloning: "Voice cloning",
  face_replication: "Face replication",
  sublicensing: "Sublicensing",
  other: "Other use",
};
const MEDIA: Record<UseRequest["media"][number], string> = {
  social: "social",
  editorial: "editorial",
  advertising: "advertising",
  broadcast: "broadcast",
  merchandise: "merchandise",
  print: "print",
  web: "web",
  in_game: "in-game",
};

function list(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

export function formatMinor(amount: number, currency: string | undefined): string {
  const major = (amount / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${major} ${currency}` : major;
}

export function describeUseRequest(r: UseRequest): string {
  const where = r.media.length ? `on ${list(r.media.map((m) => MEDIA[m]))}` : "on unstated channels";
  const territory = r.territory.length ? (r.territory.includes("WORLD") ? "worldwide" : `in ${list(r.territory)}`) : "in an unstated territory";
  const length = r.durationDays !== undefined ? `for ${r.durationDays} day${r.durationDays === 1 ? "" : "s"}` : "for an unstated length of time";
  const flags = [
    r.commercial ? "commercial" : "non-commercial",
    r.likeness && "uses the person's likeness",
    r.aiGeneration && "creates AI-generated content",
    r.aiTraining && "uses the asset for AI training",
    r.sublicensing && "includes sublicensing",
  ].filter((x): x is string => Boolean(x));
  const fee = r.offeredFeeMinor !== undefined ? `Offers ${formatMinor(r.offeredFeeMinor, r.currency)}.` : "No fee stated.";
  const credit = r.attributionOffered === true ? " Credit offered." : r.attributionOffered === false ? " No credit offered." : "";
  return `${USE[r.useType]} ${where} ${territory} ${length}; ${list(flags)}. ${fee}${credit}`;
}
