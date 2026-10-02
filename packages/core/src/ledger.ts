import type { Commitment } from "./commitment.js";

/**
 * Ledger boundary. Everything that will eventually touch Midnight goes
 * through this interface. Until the wallet/token milestone, only the
 * DemoLedger exists.
 *
 * The result type makes it IMPOSSIBLE for demo mode to return a txId:
 * a txId only exists on the `anchored` variant, which only a real
 * Midnight adapter may construct.
 */
export type AnchorResult =
  | { status: "anchored"; mode: "midnight"; network: string; txId: string; contractAddress: string }
  | { status: "not_anchored"; mode: "demo"; localRef: string; label: "DEMO — not committed to Midnight" }
  | { status: "failed"; mode: "midnight" | "demo"; error: string };

export interface AnchorRequest {
  /** Public, chain-safe identifier (never derived from personal data). */
  recordId: string;
  commitment: Commitment;
  /** Client-generated; the same key must never anchor twice. */
  idempotencyKey: string;
}

export interface LedgerAdapter {
  readonly mode: "demo" | "midnight";
  anchor(req: AnchorRequest): Promise<AnchorResult>;
}

export class DemoLedger implements LedgerAdapter {
  readonly mode = "demo" as const;
  private seen = new Map<string, AnchorResult>();

  async anchor(req: AnchorRequest): Promise<AnchorResult> {
    const prior = this.seen.get(req.idempotencyKey);
    if (prior) return prior; // idempotent: retries return the original result
    const result: AnchorResult = {
      status: "not_anchored",
      mode: "demo",
      localRef: `demo:${req.recordId}:${req.commitment.domain}`,
      label: "DEMO — not committed to Midnight",
    };
    this.seen.set(req.idempotencyKey, result);
    return result;
  }
}
