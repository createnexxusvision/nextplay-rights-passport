# Cryptography

This page lists every cryptographic scheme in NextPlay Rights Passport, the parameters it uses, and what it does and doesn't guarantee. The code lives in [`packages/core/src`](../packages/core/src). It's an experimental hackathon build and hasn't been audited.

**Libraries.** Hashing, key derivation and encryption use WebCrypto, which behaves the same in Node 22+ and in browsers. There are two exceptions, both from the audited, zero-dependency [`@noble`](https://paulmillr.com/noble/) libraries:
- `@noble/hashes` for streaming SHA-256, because WebCrypto has no incremental digest.
- `@noble/curves` for Ed25519, because browser WebCrypto support for Ed25519 is still uneven.

**Canonical JSON.** Every scheme that hashes or signs structured data first runs it through `canonicalize()`. That's a JCS-style subset (RFC 8785): keys are sorted by UTF-16 code unit, non-finite numbers are rejected, and `-0` becomes `0`. Free-text fields are NFC-normalized in the zod schemas, so the same text gives the same bytes whichever way it was typed.

| Scheme | File | Primitive | Public output |
|---|---|---|---|
| Content fingerprint | `commitment.ts`, `stream-hash.ts` | SHA-256 | file hash |
| Salted commitment | `commitment.ts` | SHA-256 | commitment |
| Encrypted vault | `vault.ts` | PBKDF2-HMAC-SHA256 → AES-256-GCM | none (local file) |
| Decision receipt | `receipts.ts` | Ed25519 | signed receipt, public keys |
| Selective disclosure | `merkle.ts` | SHA-256 Merkle tree | root + tree size |

---

## 1. Content fingerprint

```
contentHash = SHA-256(file bytes)
```

- **What it guarantees.** The fingerprint identifies the exact bytes of a registered file. Changing one bit of the file changes the fingerprint.
- **Streaming.** The browser hashes `file.stream()` chunk by chunk with `sha256.create()`, so a multi-GB video never has to fit in memory. Streaming and one-shot hashing give identical output.
- **No salt, on purpose.** Its job is to let anyone holding a copy of the file check that it's the registered one. The flip side: anyone holding a copy can do that check. If you register content before it's released, keep that in mind.
- **What it doesn't do.** It doesn't prove ownership or authorship, and it doesn't detect re-encoded or edited copies. It's an exact-match fingerprint, not perceptual matching.

## 2. Salted, domain-separated commitment (policy seal)

```
commitment = SHA-256( "nextplay:<domain>:v1" ‖ 0x00 ‖ salt[32] ‖ canonicalJSON(value) )
```

- **Domains.** `asset-metadata`, `rights-policy`, `agreement`, `split`, `license`, `evidence`, `use-request`.
- **Hiding.** The 32-byte random salt stops anyone brute-forcing low-entropy terms (a fee, a percentage, a territory) from the public hash.
- **Binding.** Opening the same commitment to two different values would require a SHA-256 collision.
- **Domain separation.** A commitment of one kind can't be replayed as another kind (for example, a policy seal presented as a license).
- **Opening.** The opening is `(salt, canonicalJSON)`, and it's private. If you lose the salt, the commitment can never be opened. That's why the encrypted private copy (section 3) exists.
- **Checking.** `verifyOpening()` compares digests in constant shape.

## 3. Encrypted vault file (private copy)

```
key        = PBKDF2-HMAC-SHA256( NFC(passphrase), salt[16], iterations ) → 256-bit key
ciphertext = AES-256-GCM( key, nonce[12], canonicalJSON(payload), AAD = canonicalJSON(header) )
header     = { format: "nextplay-vault/v1", kdf: { name, iterations, salt }, cipher: { name, nonce } }
```

| Parameter | Value |
|---|---|
| KDF | PBKDF2-HMAC-SHA256, **600,000** iterations minimum (OWASP), 10,000,000 maximum |
| KDF salt | 16 random bytes per file |
| Cipher | AES-256-GCM, 128-bit tag |
| Nonce | 12 random bytes per file (each file also gets a fresh key, from its fresh salt) |
| AAD | the whole header, canonical JSON |
| Passphrase | NFC-normalized; the web app requires at least 12 characters |

- **Confidentiality and integrity.** You can't read the file without the passphrase. Changing any ciphertext byte makes decryption fail.
- **Authenticated parameters.** Because the header is the AAD, editing the format, iteration count, salt or nonce makes decryption fail. Nobody can quietly downgrade the KDF. Iteration counts outside the allowed bounds are also rejected before any key is derived.
- **Uniform errors.** Every failure produces the same error, so it never reveals whether the passphrase or the file was at fault.
- **Checked on import.** The web app decrypts the private copy, then re-checks every seal against its terms before trusting any of it.
- **Limits.** Security depends on the passphrase. A weak passphrase can be guessed offline, at a cost of 600k PBKDF2 rounds per guess. There's no recovery.

## 4. Signed decision receipts

```
message   = "nextplay:receipt:v1" ‖ 0x00 ‖ canonicalJSON(receipt)
signature = Ed25519.sign(apiSecretKey, message)        (RFC 8032, pure Ed25519)
kid       = hex( SHA-256(publicKey)[0..8] )
receipt   = { v, alg, kid, receiptId, issuedAt,
              policyCommitment, policyVersion, requestCommitment,
              decision, denials, reviews, engineVersion, model, basis }
```

- **Authenticity.** A receipt proves that the API holding key `kid` issued exactly this decision for exactly this policy seal and request commitment. Changing any field, the signature or the `kid` makes verification fail. `kid` and `alg` sit inside the signed body.
- **Policy binding.** The caller sends the opening of its policy seal along with the request. The API checks the opening against the policy and refuses a mismatch, so `policyCommitment` in a receipt is a commitment the API actually verified.
- **Request privacy.** `requestCommitment` is a salted `use-request` commitment. Only the caller receives its opening, which lets them prove later which request was decided. The receipt alone doesn't reveal the request.
- **Basis.** `basis` records what the decision is bound to:
  - `structured_terms`: the requester supplied or confirmed structured terms.
  - `ai_extraction`: the terms are what the AI read from free text, and are provisional until confirmed.
- **Verification.** Strict RFC 8032 verification (`zip215: false`). Public keys are published at `GET /api/v1/keys`:
  - Retired keys are still listed there, so older receipts keep verifying after a key rotation.
  - A verifier rejects any key entry whose `kid` doesn't match its key.
- **Key handling.** The signing key is a 32-byte seed in `RECEIPT_SIGNING_KEY`, from a secret manager. Production refuses to start without it. Development uses a throwaway key and prints a loud warning.
- **What the passport shows.** The web passport shows "Signed by NextPlay rights engine" only after the receipt verifies and matches the seal, version and decision on screen.
- **Limits.**
  - A receipt proves what the engine decided. It doesn't prove that the policy owner has rights to the asset.
  - The web app gets its verification keys from the same API origin it talks to.

## 5. Selective disclosure (Merkle)

```
leaf_i = SHA-256( 0x00 ‖ "nextplay:field:v1" ‖ salt_i[32] ‖ canonicalJSON({ k_i: v_i }) )
node   = SHA-256( 0x01 ‖ left ‖ right )
root   = RFC 6962 Merkle Tree Hash over leaves, fields sorted by key (UTF-16 code units)
public = { root, treeSize }
```

- **Selective disclosure.** `proveField(opening, "aiTraining")` reveals `{ aiTraining: false }`, its salt and the sibling hashes, and nothing else. The fee and every other field stay hidden behind their own salts.
- **Verification.** `verifyField({ root, treeSize }, proof)` follows RFC 9162 §2.1.3.2. The tree size comes from the published commitment, not from the proof.
- **Domain separation.** Leaves are prefixed 0x00 and inner nodes 0x01 (as in RFC 6962), so an inner node can't pass as a leaf.
- **Limits.**
  - `treeSize` reveals how many fields were committed.
  - Fields that were left out can't be proven absent.
- **Toward zero knowledge.** The leaves are designed to become private inputs to Midnight zero-knowledge predicates later (for example, "fee ≥ X").

---

## Hard rules

- **No secrets in the browser.** Salts, openings, private copies and passphrases never leave the browser, with one exception: a policy seal's salt is sent to the API when a request is checked, so the API can bind the receipt. The API already sees that policy's plaintext, and it never logs or stores the salt.
- **Server keys stay on the server.** They come from env or a secret manager. No `VITE_*` variable ever holds a secret.
- **Randomness.** All random values come from `crypto.getRandomValues`.
