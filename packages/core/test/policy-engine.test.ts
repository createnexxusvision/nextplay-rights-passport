import { describe, expect, it } from "vitest";
import { applyAIGate, evaluate, RightsPolicy, UseRequest } from "../src/index.js";

const policy = RightsPolicy.parse({
  version: 3,
  territory: ["us", "CA"],
  media: ["social", "web"],
  durationDays: 90,
  commercialUse: true,
  aiTraining: false,
  aiGeneration: false,
  likenessUse: false,
  sublicensing: false,
  attributionRequired: true,
  minimumFeeMinor: 100000,
  currency: "usd",
});

const base = {
  useType: "social",
  media: ["social"],
  territory: ["US"],
  durationDays: 30,
  commercial: true,
  aiTraining: false,
  aiGeneration: false,
  likeness: false,
  sublicensing: false,
  offeredFeeMinor: 150000,
  currency: "USD",
} as const;
const req = (o: Partial<Record<string, unknown>> = {}) => UseRequest.parse({ ...base, ...o });

describe("policy engine", () => {
  it("normalizes policy sets (sorted, upper-cased)", () => {
    expect(policy.territory).toEqual(["CA", "US"]);
    expect(policy.currency).toBe("USD");
  });
  it("allows an in-scope request and carries obligations", () => {
    const ev = evaluate(policy, req());
    expect(ev.decision).toBe("ALLOWED");
    expect(ev.obligations).toEqual(["attribution_required"]);
  });
  it("denies AI generation + likeness (the hackathon demo case)", () => {
    const ev = evaluate(policy, req({ useType: "ai_generation", aiGeneration: true, likeness: true }));
    expect(ev.decision).toBe("DENIED");
    expect(ev.denials).toEqual(["ai_generation_not_authorized", "likeness_use_not_authorized"]);
  });
  it("denies out-of-territory, over-duration, under-fee", () => {
    const ev = evaluate(policy, req({ territory: ["GB"], durationDays: 365, offeredFeeMinor: 10 }));
    expect(ev.denials).toEqual(["territory_not_authorized", "duration_exceeds_policy", "fee_below_minimum"]);
  });
  it("routes missing info and currency mismatch to review, not allow", () => {
    expect(evaluate(policy, req({ durationDays: undefined })).decision).toBe("NEEDS_REVIEW");
    expect(evaluate(policy, req({ currency: "EUR" })).reviews).toContain("currency_mismatch");
  });
  it("WORLD territory covers everything", () => {
    const world = RightsPolicy.parse({ ...policy, territory: ["WORLD"] });
    expect(evaluate(world, req({ territory: ["JP"] })).decision).toBe("ALLOWED");
  });
  it("AI gate can only make results more cautious", () => {
    const allowed = evaluate(policy, req());
    expect(applyAIGate(allowed, { confidence: 0.95, missingInformation: [] }).decision).toBe("ALLOWED");
    expect(applyAIGate(allowed, { confidence: 0.5, missingInformation: [] }).decision).toBe("NEEDS_REVIEW");
    expect(applyAIGate(allowed, null).decision).toBe("NEEDS_REVIEW");
    const denied = evaluate(policy, req({ aiTraining: true }));
    expect(applyAIGate(denied, { confidence: 1, missingInformation: [] }).decision).toBe("DENIED");
  });
  it("rejects malformed input at the schema boundary", () => {
    expect(() => UseRequest.parse({ ...base, offeredFeeMinor: 12.5 })).toThrow();
    expect(() => UseRequest.parse({ ...base, extra: "x" })).toThrow();
    expect(() => RightsPolicy.parse({ ...policy, currency: undefined })).toThrow();
  });
});

describe("rights layering (claim basis)", async () => {
  const { evaluate } = await import("../src/policy-engine.js");
  const { RightsPolicy, UseRequest } = await import("../src/schemas.js");
  const base = { version: 1, territory: ["US"], media: ["social"], commercialUse: true, aiTraining: false, aiGeneration: false,
    likenessUse: true, sublicensing: false, attributionRequired: false };
  const req = UseRequest.parse({ useType: "social", media: ["social"], territory: ["US"], commercial: true, aiTraining: false,
    aiGeneration: false, likeness: true, sublicensing: false });
  it("original (or absent) content: a matching request is allowed", () => {
    expect(evaluate(RightsPolicy.parse(base), req).decision).toBe("ALLOWED");
    expect(evaluate(RightsPolicy.parse({ ...base, claimBasis: "original" }), req).decision).toBe("ALLOWED");
  });
  it("likeness only: the content owner must also agree", () => {
    const ev = evaluate(RightsPolicy.parse({ ...base, claimBasis: "likeness_only" }), req);
    expect(ev).toMatchObject({ decision: "NEEDS_REVIEW", reviews: ["content_owner_consent_required"] });
  });
  it("licensed in: the upstream license must be checked", () => {
    expect(evaluate(RightsPolicy.parse({ ...base, claimBasis: "licensed" }), req).reviews).toEqual(["upstream_license_check"]);
  });
  it("a denial still wins over a review", () => {
    const ev = evaluate(RightsPolicy.parse({ ...base, claimBasis: "likeness_only", likenessUse: false }), req);
    expect(ev.decision).toBe("DENIED");
  });
  it("leaves commitments of older policies unchanged when absent", async () => {
    const { canonicalize } = await import("../src/canonical.js");
    expect(canonicalize(RightsPolicy.parse(base))).not.toContain("claimBasis");
  });
});
