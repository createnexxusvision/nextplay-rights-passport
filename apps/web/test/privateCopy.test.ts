import { describe, expect, it } from "vitest";
import { commit, RightsPolicy, sealVault, VaultError } from "@nextplay/core";
import { exportPrivateCopy, importPrivateCopy } from "../src/privateCopy";
import type { VaultAsset } from "../src/vault";

const policy = RightsPolicy.parse({
  version: 1, territory: ["US"], media: ["social"], commercialUse: true, aiTraining: false, aiGeneration: false,
  likenessUse: false, sublicensing: false, attributionRequired: true, minimumFeeMinor: 150000, currency: "USD",
});
const pass = "a long enough passphrase";

async function assetFixture(): Promise<VaultAsset> {
  const { commitment, opening } = await commit("rights-policy", policy);
  const splits = [{ contributorRef: "c1", role: "athlete" as const, bps: 7000 }, { contributorRef: "c2", role: "filmer" as const, bps: 3000 }];
  const split = await commit("split", splits);
  return {
    id: "a1", title: "Game-winner", assetType: "video", creatorRole: "athlete", fileName: "clip.mp4", sizeBytes: 10,
    contentHash: "0x" + "ab".repeat(32), registeredAt: "2026-10-05T00:00:00.000Z",
    contributors: [{ id: "c1", name: "Jordan", role: "athlete", pct: "70" }, { id: "c2", name: "Sam", role: "filmer", pct: "30" }],
    sealed: [{ policy, commitment, opening, sealedAt: "2026-10-05T00:00:00.000Z" }],
    splitSeal: { splits, commitment: split.commitment, opening: split.opening, sealedAt: "2026-10-05T00:00:00.000Z" },
    licensing: "open", revoked: false, disclose: { title: true, assetType: true, contributors: false },
  };
}

describe("private copy (S6), multi-asset v2", () => {
  it("exports every asset encrypted and imports them back with re-verified seals", async () => {
    const a = await assetFixture();
    const b = { ...a, id: "a2", title: "Logo", assetType: "design" as const, splitSeal: undefined, revoked: true };
    delete (b as Partial<VaultAsset>).splitSeal;
    const file = JSON.stringify(await exportPrivateCopy([a, b], pass));
    for (const secret of [a.sealed[0]!.opening.salt, "Jordan", "150000"]) expect(file).not.toContain(secret);
    expect(await importPrivateCopy(file, pass)).toEqual([a, b]);
  });

  it("rejects short passphrases and wrong passphrases", async () => {
    const a = await assetFixture();
    await expect(exportPrivateCopy([a], "short")).rejects.toBeInstanceOf(VaultError);
    const file = JSON.stringify(await exportPrivateCopy([a], pass));
    await expect(importPrivateCopy(file, pass + "x")).rejects.toBeInstanceOf(VaultError);
  });

  it("rejects a copy whose policy or split doesn't match its seal", async () => {
    const a = await assetFixture();
    const forgedPolicy = { ...a, sealed: [{ ...a.sealed[0]!, policy: { ...policy, minimumFeeMinor: 1 } }] };
    const f1 = JSON.stringify(await sealVault({ kind: "nextplay-private-copy", v: 2, assets: [forgedPolicy] }, pass));
    await expect(importPrivateCopy(f1, pass)).rejects.toThrow(/doesn't match/);
    const forgedSplit = { ...a, splitSeal: { ...a.splitSeal!, splits: [{ contributorRef: "c1", role: "athlete", bps: 10000 }] } };
    const f2 = JSON.stringify(await sealVault({ kind: "nextplay-private-copy", v: 2, assets: [forgedSplit] }, pass));
    await expect(importPrivateCopy(f2, pass)).rejects.toThrow(/doesn't match/);
  });

  it("still imports an older single-asset v1 copy", async () => {
    const a = await assetFixture();
    const v1 = { kind: "nextplay-private-copy", v: 1, asset: { title: "Old clip", assetType: "Highlight video", fileName: "old.mp4", sizeBytes: 5, contentHash: a.contentHash, registeredAt: a.registeredAt }, sealed: a.sealed };
    const [restored] = await importPrivateCopy(JSON.stringify(await sealVault(v1, pass)), pass);
    expect(restored).toMatchObject({ title: "Old clip", contentHash: a.contentHash, sealed: a.sealed, licensing: "open", revoked: false });
  });
});
