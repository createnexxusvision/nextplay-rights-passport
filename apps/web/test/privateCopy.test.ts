import { describe, expect, it } from "vitest";
import { commit, RightsPolicy, sealVault, VaultError } from "@nextplay/core";
import { exportPrivateCopy, importPrivateCopy, type Sealed } from "../src/privateCopy";

const policy = RightsPolicy.parse({
  version: 1, territory: ["US"], media: ["social"], commercialUse: true, aiTraining: false, aiGeneration: false,
  likenessUse: false, sublicensing: false, attributionRequired: true, minimumFeeMinor: 150000, currency: "USD",
});
const pass = "a long enough passphrase";

async function sealedFixture(): Promise<Sealed[]> {
  const { commitment, opening } = await commit("rights-policy", policy);
  return [{ policy, commitment, opening, sealedAt: "2026-10-03T00:00:00.000Z" }];
}

describe("private copy (S6)", () => {
  it("exports encrypted and imports back with re-verified seals", async () => {
    const sealed = await sealedFixture();
    const file = JSON.stringify(await exportPrivateCopy(null, sealed, pass));
    expect(file).not.toContain(sealed[0]!.opening.salt);
    expect(file).not.toContain("150000");
    expect(await importPrivateCopy(file, pass)).toEqual({ asset: null, sealed });
  });

  it("rejects short passphrases and wrong passphrases", async () => {
    const sealed = await sealedFixture();
    await expect(exportPrivateCopy(null, sealed, "short")).rejects.toBeInstanceOf(VaultError);
    const file = JSON.stringify(await exportPrivateCopy(null, sealed, pass));
    await expect(importPrivateCopy(file, pass + "x")).rejects.toBeInstanceOf(VaultError);
  });

  it("rejects a copy whose terms don't match the seal", async () => {
    const [s] = await sealedFixture();
    const forged = { ...s!, policy: { ...policy, minimumFeeMinor: 1 } };
    const file = JSON.stringify(await sealVault({ kind: "nextplay-private-copy", v: 1, asset: null, sealed: [forged] }, pass));
    await expect(importPrivateCopy(file, pass)).rejects.toThrow(/doesn't match/);
  });
});
