import { describe, expect, it } from "vitest";
import { describeUseRequest } from "../src/explain.js";
import { UseRequest } from "../src/schemas.js";

describe("deterministic request summary", () => {
  it("describes every stated term", () => {
    const r = UseRequest.parse({ useType: "ai_generation", media: ["advertising", "web"], territory: ["US"], durationDays: 60,
      commercial: true, aiTraining: false, aiGeneration: true, likeness: true, sublicensing: false, offeredFeeMinor: 500000, currency: "USD" });
    expect(describeUseRequest(r)).toBe(
      "AI-generated content on advertising and web in US for 60 days; commercial, uses the person's likeness and creates AI-generated content. Offers 5,000.00 USD.",
    );
  });
  it("says what is missing instead of guessing", () => {
    const r = UseRequest.parse({ useType: "other", media: [], territory: [], commercial: true, aiTraining: false,
      aiGeneration: false, likeness: false, sublicensing: false, attributionOffered: true });
    expect(describeUseRequest(r)).toBe(
      "Other use on unstated channels in an unstated territory for an unstated length of time; commercial. No fee stated. Credit offered.",
    );
  });
  it("is deterministic", () => {
    const r = UseRequest.parse({ useType: "social", media: ["social"], territory: ["WORLD"], durationDays: 1, commercial: false,
      aiTraining: false, aiGeneration: false, likeness: false, sublicensing: false });
    expect(describeUseRequest(r)).toBe(describeUseRequest(r));
    expect(describeUseRequest(r)).toContain("worldwide for 1 day; non-commercial");
  });
});
