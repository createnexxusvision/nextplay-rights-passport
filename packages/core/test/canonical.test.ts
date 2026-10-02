import { describe, expect, it } from "vitest";
import { canonicalize, CanonicalizationError } from "../src/index.js";

describe("canonicalize", () => {
  it("is independent of key insertion order", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: [3, "x"] } })).toBe(canonicalize({ a: { c: [3, "x"], d: 2 }, b: 1 }));
  });
  it("sorts by code unit, not locale", () => {
    // localeCompare would place "a" before "B"; code-unit order puts "B" first.
    expect(canonicalize({ a: 1, B: 2 })).toBe('{"B":2,"a":1}');
  });
  it("drops undefined properties, normalizes -0", () => {
    expect(canonicalize({ a: undefined, b: -0 })).toBe('{"b":0}');
  });
  it("rejects non-finite numbers and non-plain objects", () => {
    expect(() => canonicalize({ x: NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ d: new Date() })).toThrow(CanonicalizationError);
    expect(() => canonicalize([undefined])).toThrow(CanonicalizationError);
  });
});
