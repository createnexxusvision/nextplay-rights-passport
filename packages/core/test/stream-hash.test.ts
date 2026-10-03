import { describe, expect, it } from "vitest";
import { contentHash } from "../src/commitment.js";
import { contentHashStream } from "../src/stream-hash.js";

function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + size));
      i += size;
    },
  });
}

describe("streaming content hash (S7)", () => {
  it("matches the one-shot hash regardless of chunking, and reports progress", async () => {
    const bytes = new Uint8Array(1_000_003).map((_, i) => (i * 31) & 0xff);
    const expected = await contentHash(bytes);
    for (const size of [7, 4096, 65_536, 2_000_000]) {
      const seen: number[] = [];
      expect(await contentHashStream(chunked(bytes, size), (n) => seen.push(n))).toBe(expected);
      expect(seen.at(-1)).toBe(bytes.length);
    }
  });

  it("hashes an empty stream to the SHA-256 of nothing", async () => {
    expect(await contentHashStream(chunked(new Uint8Array(0), 10))).toBe(
      "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
