import { canonicalize } from "./canonical.js";

/**
 * Encrypted vault file (C1) — protects the private copy of sealed terms
 * (salts + plaintext policy) at rest, e.g. in a Downloads folder.
 *
 *   key        = PBKDF2-HMAC-SHA256(NFC(passphrase), salt[16], iterations ≥ 600,000) → 256 bits
 *   ciphertext = AES-256-GCM(key, nonce[12], plaintext = canonicalJSON(payload), AAD = canonicalJSON(header))
 *
 * The header (format tag, KDF params, cipher params) is authenticated as AAD,
 * so editing any parameter — e.g. lowering the iteration count — makes
 * decryption fail instead of silently weakening the file.
 * WebCrypto only: identical in Node 22+ and browsers.
 */
export const VAULT_FORMAT = "nextplay-vault/v1";
/** OWASP Password Storage Cheat Sheet recommendation for PBKDF2-HMAC-SHA256. */
export const VAULT_MIN_ITERATIONS = 600_000;
/** Upper bound so a crafted file can't make the opener spin for minutes. */
export const VAULT_MAX_ITERATIONS = 10_000_000;

export interface VaultHeader {
  format: typeof VAULT_FORMAT;
  kdf: { name: "PBKDF2-HMAC-SHA256"; iterations: number; salt: string };
  cipher: { name: "AES-256-GCM"; nonce: string };
}
export interface VaultFile extends VaultHeader {
  ciphertext: string;
}

/** Deliberately vague: never reveal whether the passphrase or the file was wrong. */
export class VaultError extends Error {
  constructor(message = "This file can't be opened with that passphrase, or it was changed.") {
    super(message);
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey("raw", enc.encode(passphrase.normalize("NFC")) as BufferSource, "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const headerOf = (f: VaultHeader): VaultHeader => ({ format: f.format, kdf: f.kdf, cipher: f.cipher });
const aad = (h: VaultHeader) => enc.encode(canonicalize(headerOf(h)));

export async function sealVault(
  payload: unknown,
  passphrase: string,
  opts: { iterations?: number } = {},
): Promise<VaultFile> {
  if (passphrase.length === 0) throw new VaultError("A passphrase is required.");
  const iterations = opts.iterations ?? VAULT_MIN_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < VAULT_MIN_ITERATIONS || iterations > VAULT_MAX_ITERATIONS) {
    throw new VaultError(`iterations must be between ${VAULT_MIN_ITERATIONS} and ${VAULT_MAX_ITERATIONS}`);
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const header: VaultHeader = {
    format: VAULT_FORMAT,
    kdf: { name: "PBKDF2-HMAC-SHA256", iterations, salt: toBase64(salt) },
    cipher: { name: "AES-256-GCM", nonce: toBase64(nonce) },
  };
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource, additionalData: aad(header) as BufferSource, tagLength: 128 },
    key,
    enc.encode(canonicalize(payload)) as BufferSource,
  );
  return { ...header, ciphertext: toBase64(new Uint8Array(ct)) };
}

/** Structural checks run BEFORE any key derivation, so junk input is cheap to reject. */
function parseVaultFile(input: unknown): { header: VaultHeader; salt: Uint8Array; nonce: Uint8Array; ct: Uint8Array } {
  const f = input as Partial<VaultFile> | null;
  if (!f || typeof f !== "object" || f.format !== VAULT_FORMAT) throw new VaultError("This isn't a NextPlay private copy.");
  const { kdf, cipher, ciphertext } = f;
  if (
    !kdf || kdf.name !== "PBKDF2-HMAC-SHA256" || typeof kdf.salt !== "string" ||
    !Number.isInteger(kdf.iterations) || kdf.iterations < VAULT_MIN_ITERATIONS || kdf.iterations > VAULT_MAX_ITERATIONS ||
    !cipher || cipher.name !== "AES-256-GCM" || typeof cipher.nonce !== "string" || typeof ciphertext !== "string"
  ) {
    throw new VaultError();
  }
  try {
    const salt = fromBase64(kdf.salt);
    const nonce = fromBase64(cipher.nonce);
    const ct = fromBase64(ciphertext);
    if (salt.length !== 16 || nonce.length !== 12 || ct.length < 16) throw new VaultError();
    return { header: headerOf(f as VaultFile), salt, nonce, ct };
  } catch {
    throw new VaultError();
  }
}

export async function openVault(file: unknown, passphrase: string): Promise<unknown> {
  const { header, salt, nonce, ct } = parseVaultFile(file);
  const key = await deriveKey(passphrase, salt, header.kdf.iterations);
  let pt: ArrayBuffer;
  try {
    pt = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: aad(header) as BufferSource, tagLength: 128 },
      key,
      ct as BufferSource,
    );
  } catch {
    throw new VaultError();
  }
  return JSON.parse(dec.decode(pt)) as unknown;
}
