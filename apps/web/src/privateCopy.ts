import { z } from "zod";
import {
  canonicalize,
  COMMITMENT_DOMAINS,
  openVault,
  RightsPolicy,
  sealVault,
  VaultError,
  verifyOpening,
  type Commitment,
  type CommitmentOpening,
  type VaultFile,
} from "@nextplay/core";
import type { PassportAsset } from "./Passport";

/**
 * The private copy (S6): every sealed policy version with its salt, encrypted
 * under a passphrase (C1). Without it a seal can never be opened, so it can be
 * imported again after a refresh.
 */
export type Sealed = { policy: RightsPolicy; commitment: Commitment; opening: CommitmentOpening; sealedAt: string };

export const MIN_PASSPHRASE = 12;

const Hex = z.string().regex(/^0x[0-9a-f]+$/i);
const PrivateCopy = z
  .object({
    kind: z.literal("nextplay-private-copy"),
    v: z.literal(1),
    asset: z
      .object({
        title: z.string().max(500),
        assetType: z.string().max(100),
        fileName: z.string().max(500),
        sizeBytes: z.number().int().nonnegative(),
        contentHash: Hex,
        registeredAt: z.string().datetime(),
      })
      .strict()
      .nullable(),
    sealed: z
      .array(
        z
          .object({
            policy: z.unknown(),
            commitment: z.object({ domain: z.enum(COMMITMENT_DOMAINS), version: z.literal(1), commitment: Hex }).strict(),
            opening: z.object({ salt: Hex, canonical: z.string() }).strict(),
            sealedAt: z.string().datetime(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();

export async function exportPrivateCopy(asset: PassportAsset | null, sealed: Sealed[], passphrase: string): Promise<VaultFile> {
  if (passphrase.length < MIN_PASSPHRASE) throw new VaultError(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  return sealVault({ kind: "nextplay-private-copy", v: 1, asset, sealed }, passphrase);
}

/** Decrypts, validates, and re-verifies every seal against its opening before trusting it. */
export async function importPrivateCopy(fileText: string, passphrase: string): Promise<{ asset: PassportAsset | null; sealed: Sealed[] }> {
  let file: unknown;
  try {
    file = JSON.parse(fileText);
  } catch {
    throw new VaultError("This isn't a NextPlay private copy.");
  }
  const parsed = PrivateCopy.safeParse(await openVault(file, passphrase));
  if (!parsed.success) throw new VaultError("The private copy is in an unexpected shape.");
  const sealed: Sealed[] = [];
  for (const s of parsed.data.sealed) {
    const policy = RightsPolicy.safeParse(s.policy);
    if (
      !policy.success ||
      s.commitment.domain !== "rights-policy" ||
      canonicalize(policy.data) !== s.opening.canonical ||
      !(await verifyOpening(s.commitment, s.opening))
    ) {
      throw new VaultError("A seal in this private copy doesn't match its terms.");
    }
    sealed.push({ policy: policy.data, commitment: s.commitment, opening: s.opening, sealedAt: s.sealedAt });
  }
  return { asset: parsed.data.asset, sealed };
}
