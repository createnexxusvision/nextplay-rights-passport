/**
 * Cloudflare Pages `_headers` for the web app (S8), generated at build time so
 * the CSP's connect-src always matches VITE_API_BASE_URL (a public origin,
 * never a secret).
 */
export function apiOrigin(apiBaseUrl: string | undefined): string | null {
  if (!apiBaseUrl) return null;
  const u = new URL(apiBaseUrl);
  if (u.protocol !== "https:" && u.hostname !== "localhost") {
    throw new Error(`VITE_API_BASE_URL must be https (got ${u.protocol})`);
  }
  return u.origin;
}

export function contentSecurityPolicy(api: string | null, extraConnect: string[] = []): string {
  const connect = ["'self'", ...(api ? [api] : []), ...extraConnect].join(" ");
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    // Every image (logo, favicon) is a same-origin file; downloads use blob: navigation, not img.
    "img-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    // Trusted Types: DOM XSS sinks (innerHTML, script src strings) refuse plain strings.
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** Extra origins the browser may call: Midnight proof server and indexer, only when configured. */
export function midnightOrigins(urls: Array<string | undefined>): string[] {
  return urls.filter((u): u is string => Boolean(u)).map((u) => apiOrigin(u)!).filter(Boolean);
}

export function pagesHeaders(apiBaseUrl: string | undefined, extraConnect: string[] = []): string {
  const api = apiOrigin(apiBaseUrl);
  return [
    "/*",
    `  Content-Security-Policy: ${contentSecurityPolicy(api, extraConnect)}`,
    "  Strict-Transport-Security: max-age=63072000; includeSubDomains",
    "  Referrer-Policy: no-referrer",
    "  X-Content-Type-Options: nosniff",
    "  X-Frame-Options: DENY",
    "  Cross-Origin-Opener-Policy: same-origin",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "",
  ].join("\n");
}
