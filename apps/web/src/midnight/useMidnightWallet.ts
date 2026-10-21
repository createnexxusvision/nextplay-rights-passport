import { useCallback, useEffect, useState } from "react";
import { NETWORK_ID, NETWORK_LABEL, PROOF_SERVER_URL, shorten } from "./config";

/**
 * The single place Lace (Midnight's wallet) is discovered, connected and
 * observed. Ported from the Lovable vault prototype.
 * Read-only: it asks Lace for the address and network, never for a seed,
 * mnemonic or private key, and it never signs anything here.
 */
type LaceApi = {
  enable: () => Promise<unknown>;
  serviceUriConfig: () => Promise<Record<string, string>>;
  apiVersion?: string;
};
declare global {
  interface Window {
    midnight?: Record<string, LaceApi>;
  }
}

export type WalletStatus = "detecting" | "unavailable" | "disconnected" | "connecting" | "connected" | "error";
export interface WalletState {
  status: WalletStatus;
  address: string;
  shortAddress: string;
  walletNetwork: string | null;
  networkMismatch: boolean;
  /** null = no proof server configured or not checked yet. */
  proofServerUp: boolean | null;
  error: string | null;
  api: unknown;
}

async function proofServerUp(): Promise<boolean | null> {
  if (!PROOF_SERVER_URL) return null;
  try {
    return (await fetch(`${PROOF_SERVER_URL}/health`)).ok;
  } catch {
    return false;
  }
}

function detectNetwork(address: string, uris: Record<string, string>): string | null {
  const haystack = `${address} ${Object.values(uris).join(" ")}`.toLowerCase();
  return ["preview", "preprod", "undeployed", "mainnet"].find((n) => haystack.includes(n)) ?? null;
}

export function useMidnightWallet() {
  const [state, setState] = useState<WalletState>({
    status: "detecting", address: "", shortAddress: "", walletNetwork: null,
    networkMismatch: false, proofServerUp: null, error: null, api: null,
  });

  // Lace injects window.midnight.mnLace shortly after load; poll briefly, then give up.
  useEffect(() => {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (window.midnight?.mnLace) {
        clearInterval(timer);
        setState((s) => (s.status === "detecting" ? { ...s, status: "disconnected" } : s));
      } else if (attempts > 10) {
        clearInterval(timer);
        setState((s) => (s.status === "detecting" ? { ...s, status: "unavailable" } : s));
      }
    }, 700);
    void proofServerUp().then((up) => setState((s) => ({ ...s, proofServerUp: up })));
    return () => clearInterval(timer);
  }, []);

  const connect = useCallback(async () => {
    const lace = window.midnight?.mnLace;
    if (!lace) return setState((s) => ({ ...s, status: "unavailable" }));
    setState((s) => ({ ...s, status: "connecting", error: null }));
    try {
      const api = (await lace.enable()) as { state: () => Promise<{ address: string }> };
      const { address } = await api.state();
      const uris = await lace.serviceUriConfig().catch(() => ({}) as Record<string, string>);
      const walletNetwork = detectNetwork(address, uris);
      setState((s) => ({
        ...s, status: "connected", address, shortAddress: shorten(address, 10, 6), walletNetwork,
        networkMismatch: Boolean(walletNetwork && walletNetwork !== NETWORK_ID), error: null, api,
      }));
    } catch (e) {
      setState((s) => ({ ...s, status: "error", error: e instanceof Error ? e.message : "Lace connection was declined." }));
    }
  }, []);

  const disconnect = useCallback(() => {
    setState((s) => ({ ...s, status: "disconnected", address: "", shortAddress: "", walletNetwork: null, networkMismatch: false, api: null, error: null }));
  }, []);

  return { ...state, networkId: NETWORK_ID, networkLabel: NETWORK_LABEL[NETWORK_ID], connect, disconnect };
}
export type Wallet = ReturnType<typeof useMidnightWallet>;
