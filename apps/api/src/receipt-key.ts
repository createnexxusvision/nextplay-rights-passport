import { fromHex, generateReceiptKey, keyId, receiptSigner, toHex, type PublicKeyEntry, type ReceiptSigner } from "@nextplay/core";

/**
 * Receipt signing key (C2). RECEIPT_SIGNING_KEY is a 32-byte Ed25519 seed as
 * hex, injected from a secret manager — never committed, never VITE_*.
 * RECEIPT_RETIRED_PUBLIC_KEYS (comma-separated hex public keys) keeps old
 * receipts verifiable after a rotation.
 * Outside production a missing key gets a throwaway one with a loud warning:
 * receipts from it stop verifying when the process restarts.
 */
export function loadReceiptSigner(
  env: NodeJS.ProcessEnv = process.env,
  warn: (msg: string) => void = console.warn,
): { signer: ReceiptSigner; retired: PublicKeyEntry[] } {
  const raw = env.RECEIPT_SIGNING_KEY?.trim();
  let signer: ReceiptSigner;
  if (raw) {
    const seed = fromHex(raw);
    if (seed.length !== 32) throw new Error("RECEIPT_SIGNING_KEY must be 32 bytes of hex");
    signer = receiptSigner(seed);
  } else if (env.APP_ENV === "production") {
    throw new Error("RECEIPT_SIGNING_KEY is required when APP_ENV=production");
  } else {
    signer = receiptSigner(generateReceiptKey());
    warn(
      "\n" + "!".repeat(72) +
      `\n!! RECEIPT_SIGNING_KEY not set: using a TEMPORARY dev key (kid ${signer.kid}).` +
      "\n!! Receipts signed now will NOT verify after this process restarts." +
      "\n!! Never run like this in production.\n" + "!".repeat(72),
    );
  }
  const retired = (env.RECEIPT_RETIRED_PUBLIC_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((hex): PublicKeyEntry => {
      const pk = fromHex(hex);
      if (pk.length !== 32) throw new Error("RECEIPT_RETIRED_PUBLIC_KEYS entries must be 32-byte hex public keys");
      return { kid: keyId(pk), alg: "Ed25519", publicKey: toHex(pk), status: "retired" };
    });
  return { signer, retired };
}
