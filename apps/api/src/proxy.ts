import { BlockList, isIPv6 } from "node:net";

/**
 * Client-IP resolution for rate limiting (finding S3).
 *
 *  none              Direct exposure. Key on the socket address; ignore all
 *                    forwarding headers (they are attacker-controlled).
 *  cloudflare        Behind Cloudflare's proxy. Only accept connections whose
 *                    socket address is in Cloudflare's published ranges, and
 *                    key on CF-Connecting-IP (Cloudflare overwrites it).
 *  cloudflare-tunnel Behind cloudflared on the same host. Only accept loopback
 *                    connections, and key on CF-Connecting-IP.
 *
 * X-Forwarded-For is never trusted: any client can prepend to it.
 */
export type TrustProxyMode = "none" | "cloudflare" | "cloudflare-tunnel";

export function parseTrustProxy(value: string | undefined): TrustProxyMode {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "" || v === "none" || v === "false") return "none";
  if (v === "cloudflare" || v === "cloudflare-tunnel") return v;
  throw new Error(`TRUST_PROXY must be none, cloudflare or cloudflare-tunnel (got "${value}")`);
}

// https://www.cloudflare.com/ips/ — review when Cloudflare announces changes.
const CLOUDFLARE_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CLOUDFLARE_V6 = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32",
];

const cloudflare = new BlockList();
for (const c of CLOUDFLARE_V4) { const [a, p] = c.split("/"); cloudflare.addSubnet(a!, Number(p), "ipv4"); }
for (const c of CLOUDFLARE_V6) { const [a, p] = c.split("/"); cloudflare.addSubnet(a!, Number(p), "ipv6"); }

const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");

function inList(list: BlockList, addr: string): boolean {
  const mapped = addr.startsWith("::ffff:") ? addr.slice(7) : addr;
  try {
    return list.check(mapped, isIPv6(mapped) ? "ipv6" : "ipv4");
  } catch {
    return false;
  }
}

/** Whether a connection from `peer` may be served at all in this mode. */
export function peerAllowed(mode: TrustProxyMode, peer: string | undefined): boolean {
  if (mode === "none") return true;
  if (!peer) return false;
  return inList(mode === "cloudflare" ? cloudflare : loopback, peer);
}

/** Rate-limit key. Call only after `peerAllowed` has passed. */
export function clientKey(
  mode: TrustProxyMode,
  peer: string | undefined,
  headers: Record<string, string | string[] | undefined>,
): string {
  if (mode !== "none") {
    const cf = headers["cf-connecting-ip"];
    if (typeof cf === "string" && cf.length > 0 && cf.length <= 45) return cf;
  }
  return peer ?? "unknown";
}
