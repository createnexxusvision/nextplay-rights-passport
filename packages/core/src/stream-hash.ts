import { sha256 } from "@noble/hashes/sha2.js";
import { toHex } from "./commitment.js";

/**
 * Streaming content fingerprint (S7). Same result as `contentHash`, but reads
 * the input chunk by chunk, so a multi-GB video never sits in memory at once.
 * WebCrypto has no incremental digest, hence @noble/hashes (audited, no deps).
 */
export async function contentHashStream(
  stream: ReadableStream<Uint8Array>,
  onProgress?: (bytesHashed: number) => void,
): Promise<string> {
  const h = sha256.create();
  const reader = stream.getReader();
  let done = 0;
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      h.update(value);
      done += value.byteLength;
      onProgress?.(done);
    }
  } finally {
    reader.releaseLock();
  }
  return toHex(h.digest());
}
