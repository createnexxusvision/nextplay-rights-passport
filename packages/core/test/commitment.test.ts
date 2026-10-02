import { describe, expect, it } from "vitest";
import { commit, contentHash, verifyOpening, randomSalt } from "../src/index.js";

const terms = { fee: 50000, territory: ["US"], pct: 7000 };

describe("commitments", () => {
  it("opens with the right salt and fails with a wrong one", async () => {
    const { commitment, opening } = await commit("license", terms);
    expect(await verifyOpening(commitment, opening)).toBe(true);
    expect(await verifyOpening(commitment, { ...opening, salt: randomSalt() })).toBe(false);
  });
  it("is hiding: same terms, different salts → different commitments", async () => {
    const a = await commit("license", terms);
    const b = await commit("license", terms);
    expect(a.commitment.commitment).not.toBe(b.commitment.commitment);
  });
  it("is domain-separated", async () => {
    const salt = randomSalt();
    const a = await commit("license", terms, salt);
    const b = await commit("rights-policy", terms, salt);
    expect(a.commitment.commitment).not.toBe(b.commitment.commitment);
    expect(await verifyOpening({ ...a.commitment, domain: "rights-policy" }, a.opening)).toBe(false);
  });
  it("is deterministic for fixed salt + value regardless of key order", async () => {
    const salt = "0x" + "11".repeat(32);
    const a = await commit("rights-policy", { a: 1, b: 2 }, salt);
    const b = await commit("rights-policy", { b: 2, a: 1 }, salt);
    expect(a.commitment.commitment).toBe(b.commitment.commitment);
  });
  it("rejects short salts", async () => {
    await expect(commit("license", terms, "0x1234")).rejects.toThrow();
  });
  it("content hash matches known SHA-256 vector", async () => {
    expect(await contentHash(new TextEncoder().encode("abc"))).toBe(
      "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
