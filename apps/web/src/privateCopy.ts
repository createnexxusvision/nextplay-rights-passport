import { z } from "zod";
import {
  canonicalize,
  COMMITMENT_DOMAINS,
  openVault,
  RightsPolicy,
  sealVault,
  SplitEntry,
  VaultError,
  verifyOpening,
  type VaultFile,
} from "@nextplay/core";
import { ASSET_TYPES, ROLES, uid, type Sealed, type SplitSeal, type VaultAsset } from "./vault";

/**
 * The private copy (S6): every asset in the vault with its sealed policy
 * versions, salts, split seal and contributor names, encrypted under a
 * passphrase (C1). It is the only way the vault survives a refresh, and the
 * only way a seal can be opened later. v1 copies (one asset) still import.
 */
export const MIN_PASSPHRASE = 12;

const Hex = z.string().regex(/^0x[0-9a-f]+$/i);
const Seal = z.object({
  commitment: z.object({ domain: z.enum(COMMITMENT_DOMAINS), version: z.literal(1), commitment: Hex }).strict(),
  opening: z.object({ salt: Hex, canonical: z.string() }).strict(),
  sealedAt: z.string().datetime(),
});
const SealedPolicy = Seal.extend({ policy: z.unknown() }).strict();
const SealedSplit = Seal.extend({ splits: z.unknown() }).strict();
const Disclose = z.object({ title: z.boolean(), assetType: z.boolean(), contributors: z.boolean() }).strict();
const Asset = z
  .object({
    id: z.string().min(1).max(64),
    title: z.string().max(500),
    assetType: z.enum(ASSET_TYPES),
    creatorRole: z.enum(ROLES),
    fileName: z.string().max(500),
    sizeBytes: z.number().int().nonnegative(),
    contentHash: z.union([Hex, z.literal("")]),
    registeredAt: z.string().datetime(),
    contributors: z.array(z.object({ id: z.string().min(1).max(64), name: z.string().max(200), role: z.enum(ROLES), pct: z.string().max(12) }).strict()).max(50),
    sealed: z.array(SealedPolicy).max(1000),
    splitSeal: SealedSplit.optional(),
    licensing: z.enum(["open", "paused"]),
    revoked: z.boolean(),
    disclose: Disclose,
  })
  .strict();
const CopyV2 = z.object({ kind: z.literal("nextplay-private-copy"), v: z.literal(2), assets: z.array(Asset).max(200) }).strict();
const CopyV1 = z
  .object({
    kind: z.literal("nextplay-private-copy"),
    v: z.literal(1),
    asset: z
      .object({ title: z.string().max(500), assetType: z.string().max(100), fileName: z.string().max(500), sizeBytes: z.number().int().nonnegative(), contentHash: Hex, registeredAt: z.string().datetime() })
      .strict()
      .nullable(),
    sealed: z.array(SealedPolicy).min(1).max(1000),
  })
  .strict();

const mismatch = () => new VaultError("A seal in this private copy doesn't match its terms.");

async function checkPolicy(s: z.infer<typeof SealedPolicy>): Promise<Sealed> {
  const policy = RightsPolicy.safeParse(s.policy);
  if (!policy.success || s.commitment.domain !== "rights-policy" || canonicalize(policy.data) !== s.opening.canonical || !(await verifyOpening(s.commitment, s.opening))) {
    throw mismatch();
  }
  return { policy: policy.data, commitment: s.commitment, opening: s.opening, sealedAt: s.sealedAt };
}

async function checkSplit(s: z.infer<typeof SealedSplit>): Promise<SplitSeal> {
  const splits = z.array(SplitEntry).safeParse(s.splits);
  if (!splits.success || s.commitment.domain !== "split" || canonicalize(splits.data) !== s.opening.canonical || !(await verifyOpening(s.commitment, s.opening))) {
    throw mismatch();
  }
  return { splits: splits.data, commitment: s.commitment, opening: s.opening, sealedAt: s.sealedAt };
}

export async function exportPrivateCopy(assets: VaultAsset[], passphrase: string): Promise<VaultFile> {
  if (passphrase.length < MIN_PASSPHRASE) throw new VaultError(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  return sealVault({ kind: "nextplay-private-copy", v: 2, assets }, passphrase);
}

/** Decrypts, validates, and re-verifies every seal against its opening before trusting it. */
export async function importPrivateCopy(fileText: string, passphrase: string): Promise<VaultAsset[]> {
  let file: unknown;
  try {
    file = JSON.parse(fileText);
  } catch {
    throw new VaultError("This isn't a NextPlay private copy.");
  }
  const data = await openVault(file, passphrase);

  const v2 = CopyV2.safeParse(data);
  if (v2.success) {
    const out: VaultAsset[] = [];
    for (const a of v2.data.assets) {
      const sealed = await Promise.all(a.sealed.map(checkPolicy));
      const { splitSeal, ...rest } = a;
      out.push({ ...rest, sealed, ...(splitSeal ? { splitSeal: await checkSplit(splitSeal) } : {}) });
    }
    return out;
  }

  const v1 = CopyV1.safeParse(data);
  if (!v1.success) throw new VaultError("The private copy is in an unexpected shape.");
  const sealed = await Promise.all(v1.data.sealed.map(checkPolicy));
  const a = v1.data.asset;
  return [
    {
      id: uid(),
      title: a?.title ?? "Imported asset",
      assetType: "video",
      creatorRole: "athlete",
      fileName: a?.fileName ?? "",
      sizeBytes: a?.sizeBytes ?? 0,
      contentHash: a?.contentHash ?? "",
      registeredAt: a?.registeredAt ?? sealed[0]!.sealedAt,
      contributors: [{ id: uid(), name: "", role: "athlete", pct: "100" }],
      sealed,
      licensing: "open",
      revoked: false,
      disclose: { title: true, assetType: true, contributors: true },
    },
  ];
}
