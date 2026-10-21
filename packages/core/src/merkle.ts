import { sha256 } from "@noble/hashes/sha2.js";
import { canonicalize } from "./canonical.js";
import { fromHex, randomSalt, toHex } from "./commitment.js";

/**
 * Selective disclosure over a record's fields (C3).
 *
 *   leaf_i = SHA-256( 0x00 || "nextplay:field:v1" || salt_i[32] || canonicalJSON({ k_i: v_i }) )
 *   node   = SHA-256( 0x01 || left || right )
 *   root   = RFC 6962 / RFC 9162 Merkle Tree Hash over the leaves, fields sorted by key (UTF-16 code units)
 *
 * The 0x00/0x01 prefixes stop a leaf being passed off as an inner node (and
 * vice versa). Each field has its own 32-byte salt, so a revealed field says
 * nothing about the others, and low-entropy values (a fee, a boolean) can't be
 * brute-forced from the root or from sibling hashes.
 *
 * `proveField("aiTraining")` reveals exactly { aiTraining: false } plus hashes;
 * the fee stays hidden. A later Midnight ZK predicate ("fee ≥ X") can take the
 * same leaves as private inputs.
 *
 * Fields whose value is `undefined` are not committed, so absence can't be
 * proven with this scheme.
 */
const FIELD_TAG = new TextEncoder().encode("nextplay:field:v1");

export interface FieldCommitment {
  /** 0x-prefixed hex. Safe to publish. */
  root: string;
  /** Number of committed fields. Published with the root; reveals the field count only. */
  treeSize: number;
}
/** PRIVATE: everything needed to produce proofs. Never publish or log. */
export interface FieldOpening {
  keys: string[];
  salts: string[];
  record: Record<string, unknown>;
}
export interface FieldProof {
  key: string;
  value: unknown;
  salt: string;
  index: number;
  treeSize: number;
  /** Sibling hashes, leaf to root. */
  path: string[];
}

function cmp(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function leafHash(salt: Uint8Array, key: string, value: unknown): Uint8Array {
  if (salt.length !== 32) throw new Error("salt must be 32 bytes");
  const body = new TextEncoder().encode(canonicalize({ [key]: value }));
  const buf = new Uint8Array(1 + FIELD_TAG.length + 32 + body.length);
  buf[0] = 0x00;
  buf.set(FIELD_TAG, 1);
  buf.set(salt, 1 + FIELD_TAG.length);
  buf.set(body, 1 + FIELD_TAG.length + 32);
  return sha256(buf);
}

function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  const buf = new Uint8Array(65);
  buf[0] = 0x01;
  buf.set(left, 1);
  buf.set(right, 33);
  return sha256(buf);
}

/** Largest power of two strictly less than n (n ≥ 2). */
function split(n: number): number {
  let k = 1;
  while (k << 1 < n) k <<= 1;
  return k;
}

function mth(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 1) return leaves[0]!;
  const k = split(leaves.length);
  return nodeHash(mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

function auditPath(m: number, leaves: Uint8Array[]): Uint8Array[] {
  if (leaves.length <= 1) return [];
  const k = split(leaves.length);
  return m < k
    ? [...auditPath(m, leaves.slice(0, k)), mth(leaves.slice(k))]
    : [...auditPath(m - k, leaves.slice(k)), mth(leaves.slice(0, k))];
}

function leavesOf(opening: FieldOpening): Uint8Array[] {
  return opening.keys.map((k, i) => leafHash(fromHex(opening.salts[i]!), k, opening.record[k]));
}

export function commitFields(
  record: Record<string, unknown>,
  saltFor: (key: string) => string = () => randomSalt(),
): { commitment: FieldCommitment; opening: FieldOpening } {
  const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort(cmp);
  if (keys.length === 0) throw new Error("cannot commit an empty record");
  const opening: FieldOpening = { keys, salts: keys.map(saltFor), record: { ...record } };
  return { commitment: { root: toHex(mth(leavesOf(opening))), treeSize: keys.length }, opening };
}

export function proveField(opening: FieldOpening, key: string): FieldProof {
  const index = opening.keys.indexOf(key);
  if (index < 0) throw new Error(`field not committed: ${key}`);
  return {
    key,
    value: opening.record[key],
    salt: opening.salts[index]!,
    index,
    treeSize: opening.keys.length,
    path: auditPath(index, leavesOf(opening)).map(toHex),
  };
}

/**
 * RFC 9162 §2.1.3.2 inclusion-proof verification. Never throws.
 * The tree size comes from the published commitment, not the proof: an
 * inclusion path alone does not pin the size of the tree it came from.
 */
export function verifyField(commitment: FieldCommitment, proof: FieldProof): boolean {
  try {
    const { root, treeSize } = commitment;
    const { index, path } = proof;
    if (proof.treeSize !== treeSize) return false;
    if (!Number.isInteger(index) || !Number.isInteger(treeSize) || index < 0 || index >= treeSize) return false;
    if (!Array.isArray(path) || path.length > 64) return false;
    let fn = index;
    let sn = treeSize - 1;
    let r = leafHash(fromHex(proof.salt), proof.key, proof.value);
    for (const hex of path) {
      const p = fromHex(hex);
      if (p.length !== 32 || sn === 0) return false;
      if ((fn & 1) === 1 || fn === sn) {
        r = nodeHash(p, r);
        if ((fn & 1) === 0) {
          while ((fn & 1) === 0 && fn !== 0) {
            fn >>= 1;
            sn >>= 1;
          }
        }
      } else {
        r = nodeHash(r, p);
      }
      fn >>= 1;
      sn >>= 1;
    }
    if (sn !== 0) return false;
    const want = fromHex(root);
    if (want.length !== 32) return false;
    let diff = 0;
    for (let i = 0; i < 32; i++) diff |= want[i]! ^ r[i]!;
    return diff === 0;
  } catch {
    return false;
  }
}
