import type { Commitment, CommitmentOpening, RightsPolicy, SplitEntry } from "@nextplay/core";

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
}

export const uid = () => crypto.randomUUID().slice(0, 8);

export function splitsOf(a: VaultAsset): SplitEntry[] {
  return a.contributors.map((c) => ({ contributorRef: c.id, role: c.role, bps: Math.round((Number.parseFloat(c.pct) || 0) * 100) }));
}

export const currentSeal = (a: VaultAsset | undefined) => a?.sealed.at(-1);
