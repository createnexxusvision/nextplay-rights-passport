import { describe, expect, it } from "vitest";
import { repairReading } from "../src/repair.js";
import { UseRequest } from "../src/schemas.js";

const base = UseRequest.parse({ useType: "social", media: ["social"], territory: ["US"], commercial: false,
  aiTraining: false, aiGeneration: false, likeness: false, sublicensing: false });

describe("repair (cautious only)", () => {
  it.each<[string, Partial<UseRequest>, Partial<UseRequest>]>([
    ["advertising use", { useType: "advertising" }, { commercial: true }],
    ["advertising channel", { media: ["advertising"] }, { commercial: true }],
    ["merchandise channel", { media: ["merchandise"] }, { commercial: true }],
    ["ai_training", { useType: "ai_training" }, { aiTraining: true }],
    ["voice_cloning", { useType: "voice_cloning" }, { aiGeneration: true, likeness: true }],
    ["sublicensing", { useType: "sublicensing" }, { sublicensing: true }],
  ])("%s", (_n, patch, expected) => {
    const { request, repairs } = repairReading({ ...base, ...patch });
    expect(request).toMatchObject(expected);
    expect(repairs.length).toBeGreaterThan(0);
  });
  it("never turns a flag off, and leaves consistent readings alone", () => {
    const all = { ...base, commercial: true, aiTraining: true, aiGeneration: true, likeness: true, sublicensing: true };
    expect(repairReading(all)).toEqual({ request: all, repairs: [] });
    expect(repairReading(base)).toEqual({ request: base, repairs: [] });
  });
});
