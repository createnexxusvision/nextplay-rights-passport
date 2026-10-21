import { describe, expect, it } from "vitest";
import { commit, generateReceiptKey, receiptSigner, RightsPolicy, toHex, verifyOpening, verifyReceipt } from "@nextplay/core";
import { buildServer } from "../src/server.js";
import { loadReceiptSigner } from "../src/receipt-key.js";

const policy = RightsPolicy.parse({
  version: 3, territory: ["US"], media: ["social"], commercialUse: true, aiTraining: false, aiGeneration: false,
  likenessUse: false, sublicensing: false, attributionRequired: true,
});
const request = { useType: "social", media: ["social"], territory: ["US"], commercial: true, aiTraining: false,
  aiGeneration: false, likeness: true, sublicensing: false };

async function setup() {
  const signer = receiptSigner(generateReceiptKey());
  const app = await buildServer({ ai: null, signer });
  const { commitment, opening } = await commit("rights-policy", policy);
  return { app, signer, policySeal: { commitment: commitment.commitment, salt: opening.salt } };
}

describe("decision receipts over the API (C2, S9)", () => {
  it("signs a receipt that verifies against GET /api/v1/keys", async () => {
    const { app, policySeal } = await setup();
    const body = (await app.inject({ method: "POST", url: "/api/v1/rights/evaluate", payload: { policy, request, policySeal } })).json();
    const { keys } = (await app.inject({ method: "GET", url: "/api/v1/keys" })).json();
    expect(keys).toHaveLength(1);
    expect(verifyReceipt(body.receipt, keys)).toMatchObject({ ok: true });
    expect(body.receipt.receipt).toMatchObject({
      policyCommitment: policySeal.commitment, policyVersion: 3, decision: "DENIED",
      denials: ["likeness_use_not_authorized"], basis: "structured_terms", model: null,
    });
  });

  it("returns the request opening only to the caller, and it opens the receipt's request commitment", async () => {
    const { app, policySeal } = await setup();
    const body = (await app.inject({ method: "POST", url: "/api/v1/rights/evaluate", payload: { policy, request, policySeal } })).json();
    const c = { domain: "use-request" as const, version: 1 as const, commitment: body.receipt.receipt.requestCommitment };
    expect(await verifyOpening(c, body.requestOpening)).toBe(true);
    expect(JSON.stringify(body.receipt)).not.toContain(body.requestOpening.salt.slice(2));
  });

  it("refuses a seal that doesn't match the policy sent", async () => {
    const { app, policySeal } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/v1/rights/evaluate", payload: { policy: { ...policy, likenessUse: true }, request, policySeal } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("policy_seal_mismatch");
  });

  it("issues no receipt without a seal or without a signer", async () => {
    const { app, policySeal } = await setup();
    expect((await app.inject({ method: "POST", url: "/api/v1/rights/evaluate", payload: { policy, request } })).json().receipt).toBeUndefined();
    const unsigned = await buildServer({ ai: null });
    expect((await unsigned.inject({ method: "POST", url: "/api/v1/rights/evaluate", payload: { policy, request, policySeal } })).json().receipt).toBeUndefined();
    expect((await unsigned.inject({ method: "GET", url: "/api/v1/keys" })).json()).toEqual({ keys: [] });
  });

  it("loads the key from env, refuses production without one, and warns loudly in dev", () => {
    const seed = toHex(generateReceiptKey());
    expect(loadReceiptSigner({ RECEIPT_SIGNING_KEY: seed }).signer.kid).toBe(loadReceiptSigner({ RECEIPT_SIGNING_KEY: seed }).signer.kid);
    expect(loadReceiptSigner({ RECEIPT_SIGNING_KEY: seed }).signer.publicKey.publicKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() => loadReceiptSigner({ APP_ENV: "production" })).toThrow(/required/);
    expect(() => loadReceiptSigner({ RECEIPT_SIGNING_KEY: "0x1234" })).toThrow(/32 bytes/);
    const warnings: string[] = [];
    loadReceiptSigner({}, (m) => warnings.push(m));
    expect(warnings.join("")).toMatch(/TEMPORARY dev key/);
  });

  it("publishes retired keys so rotated receipts still verify", async () => {
    const old = receiptSigner(generateReceiptKey());
    const oldReceipt = old.sign({ policyCommitment: "0x" + "00".repeat(32), policyVersion: 1, requestCommitment: "0x" + "00".repeat(32),
      decision: "ALLOWED", denials: [], reviews: [], engineVersion: "policy-engine/1.0.0", model: null, basis: "structured_terms" });
    const { retired } = loadReceiptSigner({ RECEIPT_RETIRED_PUBLIC_KEYS: old.publicKey.publicKey }, () => {});
    const app = await buildServer({ ai: null, signer: receiptSigner(generateReceiptKey()), retiredKeys: retired });
    const { keys } = (await app.inject({ method: "GET", url: "/api/v1/keys" })).json();
    expect(keys.map((k: { status: string }) => k.status)).toEqual(["active", "retired"]);
    expect(verifyReceipt(oldReceipt, keys)).toMatchObject({ ok: true });
  });
});
