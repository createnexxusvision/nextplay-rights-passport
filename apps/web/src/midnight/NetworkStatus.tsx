import { NETWORK_ID } from "./config";
import type { Wallet } from "./useMidnightWallet";

export type AIStatus = "enabled" | "disabled" | "offline" | "checking";

/** Header chips: network, demo vs on-chain, wallet network mismatch, proof server, AI. */
export function NetworkStatus({ wallet, isLive, ai }: { wallet: Wallet; isLive: boolean; ai: AIStatus }) {
  return (
    <div className="chips-row">
      <span className="pill">
        <span className={`dot ${isLive ? "dot-ok" : "dot-slate"}`} aria-hidden="true" />
        {wallet.networkLabel}
      </span>
      {!isLive && <span className="pill pill-gold">Demo mode · not on-chain</span>}
      {wallet.networkMismatch && (
        <span className="pill pill-danger">Lace is on {wallet.walletNetwork}. Switch it to {NETWORK_ID}.</span>
      )}
      {wallet.proofServerUp === false && <span className="pill">Proof server offline</span>}
      <span className="pill" role="status">
        <span className={`dot ${ai === "enabled" ? "dot-ok" : ai === "offline" ? "dot-danger" : "dot-gold"}`} aria-hidden="true" />
        {ai === "checking" ? "Connecting…" : ai === "enabled" ? "Nemotron on" : ai === "disabled" ? "AI off · use the form" : "Rights API offline"}
      </span>
    </div>
  );
}
