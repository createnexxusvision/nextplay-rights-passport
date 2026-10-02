import { describe, expect, it } from "vitest";
import { allocate, commit, DemoLedger, validateSplits, type SplitEntry } from "../src/index.js";

const s = (bps: number[]): SplitEntry[] => bps.map((b, i) => ({ contributorRef: `c${i}`, role: "creator", bps: b }));

describe("splits", () => {
  it("requires exactly 10000 bps and unique contributors", () => {
    expect(validateSplits(s([5000, 5000]))).toEqual([]);
    expect(validateSplits(s([5000, 4999]))[0]).toMatch(/must equal 10000/);
    expect(validateSplits([...s([5000]), { contributorRef: "c0", role: "editor", bps: 5000 }])).toContain(
      "duplicate contributor c0",
    );
  });
  it("allocation always sums exactly to the amount (randomized)", () => {
    for (let n = 0; n < 500; n++) {
      const k = 1 + (n % 6);
      const cuts = Array.from({ length: k - 1 }, () => 1 + Math.floor(Math.random() * 9998)).sort((a, b) => a - b);
      const uniq = [...new Set(cuts)];
      const bps = [...uniq, 10000].map((c, i, arr) => c - (i ? arr[i - 1]! : 0)).filter((b) => b > 0);
      const amount = BigInt(Math.floor(Math.random() * 1e9));
      const out = allocate(amount, s(bps));
      expect([...out.values()].reduce((a, b) => a + b, 0n)).toBe(amount);
    }
  });
  it("is deterministic on ties", () => {
    expect([...allocate(1n, s([5000, 5000])).values()]).toEqual([1n, 0n]);
  });
});

describe("DemoLedger", () => {
  it("never returns a txId and is idempotent", async () => {
    const ledger = new DemoLedger();
    const { commitment } = await commit("rights-policy", { v: 1 });
    const a = await ledger.anchor({ recordId: "r1", commitment, idempotencyKey: "k1" });
    const b = await ledger.anchor({ recordId: "r1", commitment, idempotencyKey: "k1" });
    expect(a).toBe(b);
    expect(a.status).toBe("not_anchored");
    expect("txId" in a).toBe(false);
  });
});
