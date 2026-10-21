import type { ClaimBasis, Commitment, CommitmentOpening, RightsPolicy, SplitEntry } from "@nextplay/core";

/** A career asset in the vault. Lives in memory; the encrypted private copy is the only persistence. */
export const ASSET_TYPES = ["video", "photo", "audio", "performance", "phrase", "design", "other"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  video: "Video / highlight",
  photo: "Photo",
  audio: "Audio",
  performance: "Performance",
  phrase: "Brand phrase",
  design: "Logo / design",
  other: "Other",
};

export const ROLES = ["athlete", "creator", "filmer", "editor", "producer", "agent", "other"] as const;
export type Role = (typeof ROLES)[number];
export const roleLabel = (r: string) => r[0]!.toUpperCase() + r.slice(1);

export type Contributor = { id: string; name: string; role: Role; pct: string };
export type Sealed = { policy: RightsPolicy; commitment: Commitment; opening: CommitmentOpening; sealedAt: string };
export type SplitSeal = { splits: SplitEntry[]; commitment: Commitment; opening: CommitmentOpening; sealedAt: string };
export type Disclose = { title: boolean; assetType: boolean; contributors: boolean };

export interface VaultAsset {
  id: string;
  title: string;
  assetType: AssetType;
  creatorRole: Role;
  fileName: string;
  sizeBytes: number;
  /** SHA-256 of the file, "" for assets restored from an older copy without one. */
  contentHash: string;
  registeredAt: string;
  contributors: Contributor[];
  sealed: Sealed[];
  splitSeal?: SplitSeal;
  licensing: "open" | "paused";
  revoked: boolean;
  disclose: Disclose;
  /** When the owner last confirmed these rights are still theirs (deals signed elsewhere make a passport stale). */
  confirmedAt?: string | undefined;
}

export const CLAIM_LABEL: Record<ClaimBasis, string> = {
  original: "I created it or own it outright",
  licensed: "I hold a license from the owner",
  likeness_only: "Someone else owns the content; I control my name, image and likeness",
};
export const CLAIM_SHORT: Record<ClaimBasis, string> = { original: "Owns the content", licensed: "Licensed in", likeness_only: "Likeness (NIL) only" };

/** A passport not reconfirmed in this long is flagged stale: rights may have been assigned elsewhere. */
export const STALE_DAYS = 180;
export function confirmedDaysAgo(a: VaultAsset, now = Date.now()): number | null {
  const at = a.confirmedAt ?? a.sealed.at(-1)?.sealedAt ?? a.registeredAt;
  return at ? Math.floor((now - Date.parse(at)) / 86_400_000) : null;
}

export const uid = () => crypto.randomUUID().slice(0, 8);

/** Input limits, kept in sync with the private-copy schema so anything you can type can be restored. */
export const MAX_TITLE = 200;
export const MAX_NAME = 120;
export const MAX_CONTRIBUTORS = 20;

export function splitsOf(a: VaultAsset): SplitEntry[] {
  return a.contributors.map((c) => ({ contributorRef: c.id, role: c.role, bps: Math.round((Number.parseFloat(c.pct) || 0) * 100) }));
}

export const currentSeal = (a: VaultAsset | undefined) => a?.sealed.at(-1);
