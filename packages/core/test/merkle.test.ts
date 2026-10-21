import { describe, expect, it } from "vitest";
import { commitFields, proveField, verifyField, type FieldProof } from "../src/merkle.js";
import { RightsPolicy } from "../src/schemas.js";

const policy = RightsPolicy.parse({
  version: 2, territory: ["US", "CA"], media: ["social", "web"], durationDays: 90, commercialUse: true,
  aiTraining: false, aiGeneration: false, likenessUse: false, sublicensing: false, attributionRequired: true,
  minimumFeeMinor: 150000, currency: "USD",
});

describe("selective disclosure (C3)", () => {
  const { commitment, opening } = commitFields(policy);

  it("proves every field of a real policy against the root", () => {
    expect(commitment.treeSize).toBe(Object.keys(policy).length);
    for (const k of opening.keys) expect(verifyField(commitment, proveField(opening, k))).toBe(true);
  });

  it("proves aiTraining:false without revealing the fee", () => {
    const proof = proveField(opening, "aiTraining");
    expect(proof).toMatchObject({ key: "aiTraining", value: false });
    expect(JSON.stringify(proof)).not.toContain("150000");
    expect(verifyField(commitment, JSON.parse(JSON.stringify(proof)))).toBe(true);
  });

  it("works for every tree size from 1 to 17 (RFC 6962 unbalanced trees)", () => {
    for (let n = 1; n <= 17; n++) {
      const rec = Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${String(i).padStart(2, "0")}`, i]));
      const { commitment: c, opening: o } = commitFields(rec);
      for (const k of o.keys) expect(verifyField(c, proveField(o, k))).toBe(true);
    }
  });

  const good = proveField(opening, "aiTraining");
  it.each<[string, Partial<FieldProof>]>([
    ["value", { value: true }],
    ["key", { key: "aiGeneration" }],
    ["salt", { salt: "0x" + "00".repeat(32) }],
    ["index", { index: good.index + 1 }],
    ["treeSize", { treeSize: good.treeSize + 1 }],
    ["treeSize and index together", { treeSize: 4, index: 1 }],
    ["path", { path: [...good.path.slice(1), good.path[0]!] }],
    ["truncated path", { path: good.path.slice(0, -1) }],
    ["extended path", { path: [...good.path, good.path[0]!] }],
  ])("rejects a tampered %s", (_n, patch) => {
    expect(verifyField(commitment, { ...good, ...patch })).toBe(false);
  });

  it("rejects a proof against another commitment of the same policy (fresh salts)", () => {
    expect(verifyField(commitFields(policy).commitment, good)).toBe(false);
  });

  it("is deterministic given the salts, and salts hide the values", () => {
    const fixed = (k: string) => "0x" + Buffer.from(k.padEnd(32, "_").slice(0, 32)).toString("hex");
    expect(commitFields(policy, fixed).commitment.root).toBe(commitFields(policy, fixed).commitment.root);
    expect(commitFields({ ...policy, minimumFeeMinor: 150001 }, fixed).commitment.root).not.toBe(commitFields(policy, fixed).commitment.root);
  });

  it("does not let an inner node pose as a leaf (domain separation)", () => {
    const { commitment: c, opening: o } = commitFields({ a: 1, b: 2 });
    const p = proveField(o, "a");
    // Claiming the root itself is a single-leaf tree must fail.
    expect(verifyField({ ...c, treeSize: 1 }, { ...p, index: 0, treeSize: 1, path: [] })).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    expect(verifyField({ ...commitment, root: "0xzz" }, good)).toBe(false);
    expect(verifyField(commitment, { ...good, path: ["0x1234"] })).toBe(false);
    expect(verifyField(commitment, { ...good, index: -1 })).toBe(false);
    expect(() => commitFields({})).toThrow();
  });
});
