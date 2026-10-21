import { describe, expect, it } from "vitest";
import { fromHex, toHex } from "../src/commitment.js";
import { generateReceiptKey, keyId, receiptSigner, verifyReceipt, type SignedReceipt } from "../src/receipts.js";

const fields = {
  policyCommitment: "0x" + "11".repeat(32),
  policyVersion: 2,
  requestCommitment: "0x" + "22".repeat(32),
  decision: "DENIED" as const,
  denials: ["likeness_use_not_authorized" as const],
  reviews: [],
  engineVersion: "policy-engine/1.0.0",
  model: "nemotron-test",
  basis: "ai_extraction" as const,
};

describe("signed decision receipts (C2)", () => {
  const signer = receiptSigner(generateReceiptKey());
  const keys = [signer.publicKey];
  const signed = signer.sign(fields);

  it("verifies with the published key", () => {
    expect(signed.receipt.kid).toBe(signer.kid);
    expect(signer.kid).toMatch(/^[0-9a-f]{16}$/);
    expect(verifyReceipt(JSON.parse(JSON.stringify(signed)), keys)).toMatchObject({ ok: true });
  });

  it.each([
    ["decision", { decision: "ALLOWED" }],
    ["denials", { denials: [] }],
    ["policyCommitment", { policyCommitment: "0x" + "33".repeat(32) }],
    ["basis", { basis: "structured_terms" }],
    ["issuedAt", { issuedAt: "2020-01-01T00:00:00.000Z" }],
    ["model", { model: null }],
  ])("rejects an altered %s", (_name, patch) => {
    const forged = { ...signed, receipt: { ...signed.receipt, ...patch } } as SignedReceipt;
    expect(verifyReceipt(forged, keys)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a flipped signature bit", () => {
    const sig = fromHex(signed.signature);
    sig[10]! ^= 1;
    expect(verifyReceipt({ ...signed, signature: toHex(sig) }, keys)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a signature by the wrong key under the right kid", () => {
    const other = receiptSigner(generateReceiptKey());
    const resigned = other.sign(fields);
    const relabelled = { ...resigned, receipt: { ...resigned.receipt, kid: signer.kid } };
    expect(verifyReceipt(relabelled, keys)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an unknown kid, and a key entry whose kid doesn't match its key", () => {
    const other = receiptSigner(generateReceiptKey());
    expect(verifyReceipt(other.sign(fields), keys)).toEqual({ ok: false, reason: "unknown_kid" });
    const spoofed = [{ ...other.publicKey, kid: signer.kid }];
    expect(verifyReceipt(signed, spoofed)).toEqual({ ok: false, reason: "unknown_kid" });
  });

  it("rejects malformed input without throwing", () => {
    expect(verifyReceipt(null, keys)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyReceipt({ receipt: { ...signed.receipt, v: 2 }, signature: signed.signature }, keys)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyReceipt({ ...signed, signature: "0x1234" }, keys)).toEqual({ ok: false, reason: "malformed" });
  });

  it("derives kid from the first 8 bytes of SHA-256(publicKey)", () => {
    expect(keyId(fromHex(signer.publicKey.publicKey))).toBe(signer.kid);
  });
});
