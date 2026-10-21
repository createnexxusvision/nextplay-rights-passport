import type { RightsPolicy, UseRequest } from "./schemas.js";

/**
 * Deterministic Rights Policy Engine — the ONLY component that decides.
 * Pure function: same (policy, request) → same result, no I/O, no AI.
 * Precedence: DENIED > NEEDS_REVIEW > ALLOWED.
 */
export type Decision = "ALLOWED" | "DENIED" | "NEEDS_REVIEW";

export type ReasonCode =
  | "commercial_use_not_authorized"
  | "ai_training_not_authorized"
  | "ai_generation_not_authorized"
  | "likeness_use_not_authorized"
  | "sublicensing_not_authorized"
  | "media_not_authorized"
  | "territory_not_authorized"
  | "duration_exceeds_policy"
  | "fee_below_minimum"
  | "duration_missing"
  | "territory_missing"
  | "media_missing"
  | "fee_missing"
  | "currency_mismatch"
  | "ai_low_confidence"
  | "ai_missing_information"
  | "ai_unavailable"
  | "request_injection_suspected"
  | "ai_readings_disagree"
  | "content_owner_consent_required"
  | "upstream_license_check";

export interface Evaluation {
  decision: Decision;
  denials: ReasonCode[];
  reviews: ReasonCode[];
  obligations: Array<"attribution_required">;
  policyVersion: number;
  engineVersion: string;
}

export const ENGINE_VERSION = "policy-engine/1.0.0";

export function evaluate(policy: RightsPolicy, req: UseRequest): Evaluation {
  const denials: ReasonCode[] = [];
  const reviews: ReasonCode[] = [];

  if (req.commercial && !policy.commercialUse) denials.push("commercial_use_not_authorized");
  if (req.aiTraining && !policy.aiTraining) denials.push("ai_training_not_authorized");
  if (req.aiGeneration && !policy.aiGeneration) denials.push("ai_generation_not_authorized");
  if (req.likeness && !policy.likenessUse) denials.push("likeness_use_not_authorized");
  if (req.sublicensing && !policy.sublicensing) denials.push("sublicensing_not_authorized");

  if (req.media.length === 0) reviews.push("media_missing");
  else if (req.media.some((m) => !policy.media.includes(m))) denials.push("media_not_authorized");

  const worldwide = policy.territory.includes("WORLD");
  if (req.territory.length === 0) reviews.push("territory_missing");
  else if (!worldwide && req.territory.some((t) => !policy.territory.includes(t)))
    denials.push("territory_not_authorized");

  if (policy.durationDays !== undefined) {
    if (req.durationDays === undefined) reviews.push("duration_missing");
    else if (req.durationDays > policy.durationDays) denials.push("duration_exceeds_policy");
  }

  if (policy.minimumFeeMinor !== undefined) {
    if (req.offeredFeeMinor === undefined) reviews.push("fee_missing");
    else if (req.currency !== policy.currency) reviews.push("currency_mismatch");
    else if (req.offeredFeeMinor < policy.minimumFeeMinor) denials.push("fee_below_minimum");
  }

  // Rights layering: the owner can't grant more than they hold. A clean match against
  // their policy is still only their part of the rights, so a person must check the rest.
  if (policy.claimBasis === "likeness_only") reviews.push("content_owner_consent_required");
  if (policy.claimBasis === "licensed") reviews.push("upstream_license_check");

  const obligations: Evaluation["obligations"] = policy.attributionRequired ? ["attribution_required"] : [];
  const decision: Decision = denials.length ? "DENIED" : reviews.length ? "NEEDS_REVIEW" : "ALLOWED";
  return { decision, denials, reviews, obligations, policyVersion: policy.version, engineVersion: ENGINE_VERSION };
}

/**
 * Fold AI uncertainty into an engine result. AI can only make a result MORE
 * cautious (ALLOWED → NEEDS_REVIEW); it can never turn DENIED into anything else.
 */
export function applyAIGate(
  ev: Evaluation,
  ai: { confidence: number; missingInformation: string[] } | null,
  minConfidence = 0.8,
): Evaluation {
  const reviews = [...ev.reviews];
  if (ai === null) reviews.push("ai_unavailable");
  else {
    if (ai.confidence < minConfidence) reviews.push("ai_low_confidence");
    if (ai.missingInformation.length > 0) reviews.push("ai_missing_information");
  }
  const decision: Decision = ev.decision === "DENIED" ? "DENIED" : reviews.length ? "NEEDS_REVIEW" : "ALLOWED";
  return { ...ev, reviews, decision };
}
