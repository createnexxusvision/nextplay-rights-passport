import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { canonicalize } from "./canonical.js";
import { fromHex, toHex } from "./commitment.js";
import type { Decision, ReasonCode } from "./policy-engine.js";

/**
 * Signed decision receipts (C2). The API signs what the engine decided, bound
 * to the sealed policy and a salted commitment to the request, so a passport
 * screenshot or a hand-edited JSON can be told apart from a real decision.
 *
 *   message   = "nextplay:receipt:v1" || 0x00 || canonicalJSON(receipt)
 *   signature = Ed25519(secretKey, message)            (RFC 8032, pure)
 *   kid       = hex(SHA-256(publicKey)[0..8])
 *
 * `kid` and `alg` sit inside the signed body, so a signature can't be
 * re-labelled as coming from another key. Ed25519 via @noble/curves runs in
 * every browser (WebCrypto Ed25519 support is still uneven).
 */
export const RECEIPT_VERSION = 1 as const;
const RECEIPT_TAG = new TextEncoder().encode("nextplay:receipt:v1");

export type ReceiptBasis = "structured_terms" | "ai_extraction";

export interface DecisionReceipt {
  v: typeof RECEIPT_VERSION;
  alg: "Ed25519";
  kid: string;
  receiptId: string;
  issuedAt: string;
  policyCommitment: string;
  policyVersion: number;
  /** Salted commitment to the evaluated UseRequest; the opening goes only to the caller. */
  requestCommitment: string;
  decision: Decision;
  denials: ReasonCode[];
  reviews: ReasonCode[];
  engineVersion: string;
  /** Model id when the request terms came from the AI, else null. */
  model: string | null;
  basis: ReceiptBasis;
}
export interface SignedReceipt {
  receipt: DecisionReceipt;
  /** 0x-prefixed hex, 64 bytes. */
  signature: string;
}
export interface PublicKeyEntry {
  kid: string;
  alg: "Ed25519";
  /** 0x-prefixed hex, 32 bytes. */
  publicKey: string;
  status: "active" | "retired";
}

export type VerifyResult = { ok: true; key: PublicKeyEntry } | { ok: false; reason: "malformed" | "unknown_kid" | "bad_signature" };

export function keyId(publicKey: Uint8Array): string {
  return toHex(sha256(publicKey).slice(0, 8)).slice(2);
}

export interface ReceiptSigner {
  readonly kid: string;
  readonly publicKey: PublicKeyEntry;
  sign(fields: Omit<DecisionReceipt, "v" | "alg" | "kid" | "receiptId" | "issuedAt">, issuedAt?: Date): SignedReceipt;
}

/** `secretKey` is the 32-byte Ed25519 seed. Keep it in a secret manager; never log it. */
export function receiptSigner(secretKey: Uint8Array): ReceiptSigner {
  if (secretKey.length !== 32) throw new Error("receipt signing key must be 32 bytes");
  const sk = Uint8Array.from(secretKey);
  const pk = ed25519.getPublicKey(sk);
  const kid = keyId(pk);
  return {
    kid,
    publicKey: { kid, alg: "Ed25519", publicKey: toHex(pk), status: "active" },
    sign(fields, issuedAt = new Date()) {
      const receipt: DecisionReceipt = {
        v: RECEIPT_VERSION,
        alg: "Ed25519",
        kid,
        receiptId: globalThis.crypto.randomUUID(),
        issuedAt: issuedAt.toISOString(),
        ...fields,
      };
      return { receipt, signature: toHex(ed25519.sign(message(receipt), sk)) };
    },
  };
}

export function generateReceiptKey(): Uint8Array {
  return ed25519.utils.randomSecretKey();
}

function message(receipt: DecisionReceipt): Uint8Array {
  const body = new TextEncoder().encode(canonicalize(receipt));
  const out = new Uint8Array(RECEIPT_TAG.length + 1 + body.length);
  out.set(RECEIPT_TAG, 0);
  out[RECEIPT_TAG.length] = 0;
  out.set(body, RECEIPT_TAG.length + 1);
  return out;
}

/** Verify against a published key set. Never throws. */
export function verifyReceipt(signed: unknown, keys: PublicKeyEntry[]): VerifyResult {
  const s = signed as Partial<SignedReceipt> | null;
  const r = s?.receipt;
  if (!s || typeof s.signature !== "string" || !r || typeof r !== "object" || r.v !== RECEIPT_VERSION || r.alg !== "Ed25519" || typeof r.kid !== "string") {
    return { ok: false, reason: "malformed" };
  }
  const key = keys.find((k) => k.kid === r.kid && k.alg === "Ed25519");
  if (!key) return { ok: false, reason: "unknown_kid" };
  try {
    const pk = fromHex(key.publicKey);
    // Strict RFC 8032 verification (zip215: false) rejects non-canonical encodings.
    // A key entry whose kid doesn't match its own key is itself a forgery.
    if (keyId(pk) !== key.kid) return { ok: false, reason: "unknown_kid" };
    const sig = fromHex(s.signature);
    if (sig.length !== 64) return { ok: false, reason: "malformed" };
    return ed25519.verify(sig, message(r), pk, { zip215: false }) ? { ok: true, key } : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}
