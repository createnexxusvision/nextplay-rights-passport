import { canonicalize } from "./canonical.js";

/**
 * Salted, domain-separated commitments.
 *
 *   commitment = SHA-256( "nextplay:<domain>:v1" || 0x00 || salt[32] || canonicalJSON )
 *
 * - The 32-byte random salt makes commitments HIDING: low-entropy terms
 *   (fee, %, territory) can no longer be brute-forced from the public hash.
 *   (Pattern adopted from QuietQuote; the vault prototype hashed without salt.)
 * - The domain tag stops a commitment for one kind of record being replayed
 *   as another (a policy hash presented as a license hash, etc.).
 * - Callers MUST keep the salt private alongside the plaintext; losing the
 *   salt means the commitment can never be opened. Never log it.
 *
 * Works in Node 22+ and browsers (WebCrypto).
 */
export const COMMITMENT_DOMAINS = [
  "asset-metadata",
  "rights-policy",
  "agreement",
  "split",
  "license",
  "evidence",
  "use-request",
] as const;
export type CommitmentDomain = (typeof COMMITMENT_DOMAINS)[number];

export interface Commitment {
  domain: CommitmentDomain;
  version: 1;
  /** 0x-prefixed lowercase hex SHA-256. Safe to publish. */
  commitment: string;
}
export interface CommitmentOpening {
  /** 0x-prefixed hex, 32 bytes. PRIVATE. */
  salt: string;
  /** The canonical JSON that was committed. PRIVATE. */
  canonical: string;
}

const enc = new TextEncoder();

export function toHex(bytes: Uint8Array): string {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^(?:[0-9a-f]{2})*$/i.test(clean)) throw new Error("invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

/** Exact content fingerprint (unsalted on purpose — it identifies a file). */
export async function contentHash(bytes: Uint8Array): Promise<string> {
  return toHex(await sha256(bytes));
}

export function randomSalt(): string {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

function preimage(domain: CommitmentDomain, salt: Uint8Array, canonical: string): Uint8Array {
  if (salt.length !== 32) throw new Error("salt must be 32 bytes");
  const tag = enc.encode(`nextplay:${domain}:v1`);
  const body = enc.encode(canonical);
  const out = new Uint8Array(tag.length + 1 + 32 + body.length);
  out.set(tag, 0);
  out[tag.length] = 0;
  out.set(salt, tag.length + 1);
  out.set(body, tag.length + 33);
  return out;
}

export async function commit(
  domain: CommitmentDomain,
  value: unknown,
  salt: string = randomSalt(),
): Promise<{ commitment: Commitment; opening: CommitmentOpening }> {
  const canonical = canonicalize(value);
  const digest = await sha256(preimage(domain, fromHex(salt), canonical));
  return {
    commitment: { domain, version: 1, commitment: toHex(digest) },
    opening: { salt, canonical },
  };
}

/** Constant-shape verification of an opening against a public commitment. */
export async function verifyOpening(c: Commitment, opening: CommitmentOpening): Promise<boolean> {
  const digest = await sha256(preimage(c.domain, fromHex(opening.salt), opening.canonical));
  const a = toHex(digest);
  const b = c.commitment.toLowerCase();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
