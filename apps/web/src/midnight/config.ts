/**
 * Midnight network config. Public build-time values only (never secrets).
 * Live on-chain mode needs a deployed contract plus indexer and proof server
 * endpoints; until all are set the app runs in clearly labeled demo mode.
 */
export type NetworkId = "preview" | "preprod" | "undeployed" | "mainnet";
const env = import.meta.env;
const NETWORKS: NetworkId[] = ["preview", "preprod", "undeployed", "mainnet"];
const requested = (env.VITE_MIDNIGHT_NETWORK as string | undefined) ?? "preview";

export const NETWORK_ID: NetworkId = NETWORKS.includes(requested as NetworkId) ? (requested as NetworkId) : "preview";
export const PROOF_SERVER_URL = ((env.VITE_PROOF_SERVER_URL as string | undefined) ?? "").replace(/\/$/, "");
export const INDEXER_URL = (env.VITE_INDEXER_URL as string | undefined) ?? "";
export const CONTRACT_ADDRESS = (env.VITE_DEFAULT_CONTRACT as string | undefined) ?? "";

export const NETWORK_LABEL: Record<NetworkId, string> = {
  preview: "Midnight Preview",
  preprod: "Midnight Preprod",
  undeployed: "Local dev chain",
  mainnet: "Midnight Mainnet",
};

/** On-chain writes need every endpoint plus a deployed contract. Anything less is demo mode. */
export function isMidnightConfigured(): boolean {
  return Boolean(CONTRACT_ADDRESS && INDEXER_URL && PROOF_SERVER_URL);
}

export function shorten(value: string, lead = 6, tail = 4): string {
  if (!value) return "";
  return value.length <= lead + tail + 3 ? value : `${value.slice(0, lead)}…${value.slice(-tail)}`;
}
