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
    expect(h).not.toMatch(/googleapis|gstatic|unsafe-inline|unsafe-eval/);
  });
  it("is same-origin only when no API URL is set, and refuses plain http", () => {
    expect(pagesHeaders(undefined)).toContain("connect-src 'self';");
    expect(() => apiOrigin("http://api.nextplay.example")).toThrow();
    expect(apiOrigin("http://localhost:8080")).toBe("http://localhost:8080");
  });
});
