import type { SplitEntry } from "./schemas.js";

export const TOTAL_BPS = 10_000;

export function validateSplits(entries: SplitEntry[]): string[] {
  const errors: string[] = [];
  if (entries.length === 0) errors.push("at least one contributor required");
  const refs = new Set<string>();
  let sum = 0;
  for (const e of entries) {
    if (!Number.isInteger(e.bps) || e.bps <= 0) errors.push(`invalid bps for ${e.contributorRef}`);
    if (refs.has(e.contributorRef)) errors.push(`duplicate contributor ${e.contributorRef}`);
    refs.add(e.contributorRef);
    sum += e.bps;
  }
  if (sum !== TOTAL_BPS) errors.push(`splits total ${sum} bps, must equal ${TOTAL_BPS}`);
  return errors;
}

/**
 * Allocate an integer amount (minor units) by basis points using the
 * largest-remainder method. Always sums exactly to `amountMinor`.
 * Ties broken by input order → deterministic. Display/simulation only in MVP:
 * no money moves in this repository.
 */
export function allocate(amountMinor: bigint, entries: SplitEntry[]): Map<string, bigint> {
  const errors = validateSplits(entries);
  if (errors.length) throw new Error(errors.join("; "));
  if (amountMinor < 0n) throw new Error("amount must be non-negative");
  const total = BigInt(TOTAL_BPS);
  const rows = entries.map((e, i) => {
    const raw = amountMinor * BigInt(e.bps);
    return { ref: e.contributorRef, i, base: raw / total, rem: raw % total };
  });
  let leftover = amountMinor - rows.reduce((s, r) => s + r.base, 0n);
  const order = [...rows].sort((a, b) => (b.rem === a.rem ? a.i - b.i : b.rem > a.rem ? 1 : -1));
  for (const r of order) {
    if (leftover === 0n) break;
    r.base += 1n;
    leftover -= 1n;
  }
  return new Map(rows.map((r) => [r.ref, r.base]));
}
