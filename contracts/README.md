# Midnight contracts: gated until the Saturday milestone

**No wallet, DUST, NIGHT, seed or deployment work happens before then.** This folder holds the spec only. The rest of the app runs on `DemoLedger`.

## RightsRegistry (planned)
This is one contract, keyed by record id. It merges the earlier vault prototype, the QuietQuote commit pattern and the draft invariants.

| Concern | Rule |
|---|---|
| Content uniqueness | Enforce `contentHash → assetId` uniqueness **on-chain**. The vault prototype checked only a browser mirror. |
| Authorization | Comes from a private witness, never from the fee payer. The sponsor may pay fees but cannot act as the user. |
| Owner secret | Must be **recoverable**, so never `localStorage`. Derivation source is to be decided Saturday (wallet-derived vs. passkey-wrapped). |
| Versioning | Policy, agreement, split and license commitments are append-only with a monotonic version per asset. No overwrite. |
| Hiding | Store only salted commitments from `@nextplay/core`. |
| Linkability | Minimize disclosed ids per circuit, and document what stays linkable. |
| Idempotency | A client idempotency key is mapped to its result. A retry after a timeout must not create a second asset. |
| Sealed offers (later) | Commit, nullifier, deadline and authorized reveal, as in QuietQuote, but with deadline enforcement and submitter authorization. |
| Upgrades | The contract is immutable. A new version gets a new address, recorded off-chain, plus a pause flag for new registrations. |

## Saturday prerequisites
1. Read the current Midnight Support Matrix and pin compiler, runtime, SDK, indexer and proof-server versions in `docs/compatibility.md`.
2. Confirm the current network endpoints from the official docs. Don't copy them from older code.
3. Decide where proving runs and who can see witness data.
4. Decide the owner-secret derivation and recovery path.
