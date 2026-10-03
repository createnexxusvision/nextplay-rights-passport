import { describe, expect, it } from "vitest";
import { extractRequestFacts, mergeRequest, type ModelRequest } from "../src/request-facts.js";

const f = extractRequestFacts;

describe("deterministic request facts", () => {
  it.each([
    ["Fee $1,500.", { offeredFeeMinor: 150000, currency: "USD" }],
    ["we can pay $100", { offeredFeeMinor: 10000, currency: "USD" }],
    ["fee GBP 3,000", { offeredFeeMinor: 300000, currency: "GBP" }],
    ["1,250.50 EUR total", { offeredFeeMinor: 125050, currency: "EUR" }],
    ["£2k budget", { offeredFeeMinor: 200000, currency: "GBP" }],
    ["Budget $5,000 and $5,000.00 again", { offeredFeeMinor: 500000, currency: "USD" }],
  ])("reads the fee in %j", (text, fee) => {
    expect(f(text).fee).toEqual(fee);
  });

  it("flags two different fees instead of picking one", () => {
    const r = f("We pay $1,000 now and $2,000 later");
    expect(r.fee).toBeUndefined();
    expect(r.conflicts).toEqual(["The request states more than one fee."]);
  });

  it.each([
    ["for 30 days", 30],
    ["a 60-day US campaign", 60],
    ["Social post for 2 weeks", 14],
    ["for two months", 60],
    ["for a year", 365],
    ["Worldwide, perpetual.", 36500],
    ["forever", 36500],
  ])("reads the duration in %j", (text, days) => {
    expect(f(text).durationDays).toBe(days);
  });

  it("never invents a duration, and flags two different ones", () => {
    expect(f("Use the photo on our website in the US, $2,000, with attribution.").durationDays).toBeUndefined();
    expect(f("the game-winner clip").durationDays).toBeUndefined();
    expect(f("30 days, or maybe 60 days").conflicts).toContain("The request states more than one duration.");
  });

  it("maps channel words to media", () => {
    expect(f("repost the highlight on Instagram and our website").media).toEqual(["social", "web"]);
    expect(f("Generate an AI video ad").media).toEqual(["advertising"]);
    expect(f("Billboard and web campaign").media).toEqual(["advertising", "web"]);
    expect(f("a TV commercial").media).toEqual(["broadcast"]);
    expect(f("the game-winner clip").media).toEqual([]);
    expect(f("a commercial use").media).toEqual([]);
  });

  it("maps countries without reading the pronoun 'us' as the US", () => {
    expect(f("in the US for 30 days").territory).toEqual(["US"]);
    expect(f("a campaign in the UK").territory).toEqual(["GB"]);
    expect(f("Worldwide, perpetual.").territory).toEqual(["WORLD"]);
    expect(f("Canada and Mexico").territory).toEqual(["CA", "MX"]);
    expect(f("Can you send us the clip?").territory).toEqual([]);
    expect(f("an American football highlight").territory).toEqual([]);
  });

  it("detects offered credit", () => {
    expect(f("with credit to the athlete").attributionOffered).toBe(true);
    expect(f("we will tag the athlete").attributionOffered).toBe(true);
    expect(f("no mention").attributionOffered).toBeUndefined();
  });

  it("is not fooled by invisible characters", () => {
    expect(f("Fee $1,5​00 for 3​0 days").fee).toEqual({ offeredFeeMinor: 150000, currency: "USD" });
  });
});

describe("merging model judgement with code-read facts", () => {
  const model: ModelRequest = { useType: "social", media: ["in_game"], territory: ["CA"], commercial: false,
    aiTraining: false, aiGeneration: false, likeness: false, sublicensing: false };
  it("code wins where it found something; model fills the rest", () => {
    const r = mergeRequest(model, f("repost on Instagram in the US for 30 days, $1,500, credit given"));
    expect(r).toEqual({ ...model, media: ["social"], territory: ["US"], durationDays: 30,
      offeredFeeMinor: 150000, currency: "USD", attributionOffered: true });
  });
  it("falls back to the model's channels and countries only when code found none", () => {
    const r = mergeRequest(model, f("something vague"));
    expect(r.media).toEqual(["in_game"]);
    expect(r.territory).toEqual(["CA"]);
    expect(r.durationDays).toBeUndefined();
    expect(r.offeredFeeMinor).toBeUndefined();
  });
});
