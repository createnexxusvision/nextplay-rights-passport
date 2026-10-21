import { describe, expect, it } from "vitest";
import { apiOrigin, pagesHeaders } from "../security-headers";

describe("web security headers (S8)", () => {
  it("locks everything to self plus the API origin", () => {
    const h = pagesHeaders("https://api.nextplay.example/some/path");
    expect(h).toContain("connect-src 'self' https://api.nextplay.example;");
    expect(h).toContain("default-src 'self'");
    expect(h).toContain("frame-ancestors 'none'");
    expect(h).toContain("Strict-Transport-Security: max-age=63072000");
    expect(h).toContain("Permissions-Policy: camera=(), microphone=(), geolocation=()");
    expect(h).not.toMatch(/googleapis|gstatic|unsafe-inline|unsafe-eval|data:|blob:/);
    expect(h).toContain("require-trusted-types-for 'script'");
    expect(h).toContain("img-src 'self';");
  });
  it("is same-origin only when no API URL is set, and refuses plain http", () => {
    expect(pagesHeaders(undefined)).toContain("connect-src 'self';");
    expect(() => apiOrigin("http://api.nextplay.example")).toThrow();
    expect(apiOrigin("http://localhost:8080")).toBe("http://localhost:8080");
  });
});

describe("Midnight endpoints in the CSP", () => {
  it("adds the proof server / indexer origins only when configured", async () => {
    const { midnightOrigins } = await import("../security-headers");
    expect(pagesHeaders(undefined, midnightOrigins([undefined, ""]))).toContain("connect-src 'self';");
    const h = pagesHeaders(undefined, midnightOrigins(["https://proof.example/v1", "https://indexer.example/api"]));
    expect(h).toContain("connect-src 'self' https://proof.example https://indexer.example;");
  });
});
