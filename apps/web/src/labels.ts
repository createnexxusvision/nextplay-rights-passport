import type { Decision, ReasonCode } from "@nextplay/core";

export const DECISION_TEXT: Record<Decision, { stamp: string; line: string }> = {
  ALLOWED: { stamp: "Allowed", line: "This use fits the policy." },
  DENIED: { stamp: "Denied", line: "This use breaks the policy." },
  NEEDS_REVIEW: { stamp: "Needs review", line: "A person needs to look at this before it goes ahead." },
};

export const REASON_TEXT: Record<ReasonCode, string> = {
  commercial_use_not_authorized: "Commercial use isn't allowed.",
  ai_training_not_authorized: "Training AI models on this asset isn't allowed.",
  ai_generation_not_authorized: "Generating AI content from this asset isn't allowed.",
  likeness_use_not_authorized: "Using the athlete's face, voice or likeness isn't allowed.",
  sublicensing_not_authorized: "Passing the license on to others isn't allowed.",
  media_not_authorized: "At least one requested channel isn't covered.",
  territory_not_authorized: "At least one requested country isn't covered.",
  duration_exceeds_policy: "The requested length of use is longer than the policy allows.",
  fee_below_minimum: "The offered fee is below the minimum.",
  duration_missing: "The request doesn't say how long it would run.",
  territory_missing: "The request doesn't say where it would run.",
  media_missing: "The request doesn't say which channels it would use.",
  fee_missing: "The request doesn't include a fee.",
  currency_mismatch: "The fee is in a different currency than the policy.",
  ai_low_confidence: "The AI wasn't confident it read the request correctly.",
  ai_missing_information: "The AI flagged details the request leaves out.",
  ai_unavailable: "Automatic reading is off, so a person has to read this request.",
  ai_readings_disagree: "The request can reasonably be read more than one way, and the readings lead to different decisions.",
  request_injection_suspected: "The request text tries to give the AI instructions, so a person has to read it.",
};

export const OBLIGATION_TEXT = { attribution_required: "Credit the athlete wherever this runs." } as const;
