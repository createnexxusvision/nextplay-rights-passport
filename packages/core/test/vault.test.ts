import { describe, expect, it } from "vitest";
import { fromBase64, openVault, sealVault, toBase64, VAULT_FORMAT, VAULT_MIN_ITERATIONS, VaultError, type VaultFile } from "../src/vault.js";

const payload = { sealed: [{ policy: { version: 1, fee: 150000 }, opening: { salt: "0x" + "ab".repeat(32) } }] };
const pass = "correct horse battery staple";

describe("encrypted vault (C1)", () => {
  let file: VaultFile;
  it("round-trips with the right passphrase", async () => {
    file = await sealVault(payload, pass);
    expect(file.format).toBe(VAULT_FORMAT);
    expect(file.kdf.iterations).toBeGreaterThanOrEqual(VAULT_MIN_ITERATIONS);
    expect(fromBase64(file.kdf.salt)).toHaveLength(16);
    expect(fromBase64(file.cipher.nonce)).toHaveLength(12);
    expect(JSON.stringify(file)).not.toContain("150000");
    expect(await openVault(JSON.parse(JSON.stringify(file)), pass)).toEqual(payload);
  });

  it("uses a fresh salt and nonce every time", async () => {
    const again = await sealVault(payload, pass);
    expect(again.kdf.salt).not.toBe(file.kdf.salt);
    expect(again.cipher.nonce).not.toBe(file.cipher.nonce);
    expect(again.ciphertext).not.toBe(file.ciphertext);
  });

  it("rejects a wrong passphrase", async () => {
    await expect(openVault(file, "correct horse battery stapler")).rejects.toBeInstanceOf(VaultError);
  });

  it("rejects a flipped ciphertext byte", async () => {
    const ct = fromBase64(file.ciphertext);
    ct[5]! ^= 0x01;
    await expect(openVault({ ...file, ciphertext: toBase64(ct) }, pass)).rejects.toBeInstanceOf(VaultError);
  });

  it("rejects a modified header (AAD)", async () => {
    await expect(openVault({ ...file, kdf: { ...file.kdf, iterations: file.kdf.iterations + 1 } }, pass)).rejects.toBeInstanceOf(VaultError);
    const nonce = fromBase64(file.cipher.nonce);
    nonce[0]! ^= 0x80;
    await expect(openVault({ ...file, cipher: { ...file.cipher, nonce: toBase64(nonce) } }, pass)).rejects.toBeInstanceOf(VaultError);
    await expect(openVault({ ...file, kdf: { ...file.kdf, extra: 1 } }, pass)).rejects.toBeInstanceOf(VaultError);
  });

  it("refuses weakened or absurd KDF parameters before deriving", async () => {
    await expect(openVault({ ...file, kdf: { ...file.kdf, iterations: 1 } }, pass)).rejects.toBeInstanceOf(VaultError);
    await expect(openVault({ ...file, kdf: { ...file.kdf, iterations: 1e12 } }, pass)).rejects.toBeInstanceOf(VaultError);
    await expect(sealVault(payload, pass, { iterations: 1000 })).rejects.toBeInstanceOf(VaultError);
    await expect(openVault({ ...file, format: "nextplay-vault/v0" }, pass)).rejects.toBeInstanceOf(VaultError);
    await expect(openVault(null, pass)).rejects.toBeInstanceOf(VaultError);
  });

  it("treats NFC and NFD passphrases as the same", async () => {
    const f = await sealVault(payload, "café passphrase");
    expect(await openVault(f, "café passphrase")).toEqual(payload);
  });
});
