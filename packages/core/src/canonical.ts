/**
 * Deterministic JSON canonicalization (RFC 8785 / JCS-style subset).
 *
 * Why this exists: two semantically identical policies MUST produce identical
 * bytes, on every machine, or commitments stop matching.
 *  - Object keys sorted by UTF-16 code unit (NOT localeCompare — that is
 *    locale-dependent and was a bug in the earlier vault prototype).
 *  - `undefined` properties are dropped; `undefined` array items are rejected.
 *  - Non-finite numbers, BigInt, functions, symbols are rejected.
 *  - Numbers serialize via ECMAScript Number→String (what JCS specifies).
 * Semantic normalization (trimming, NFC, sorting unordered arrays) belongs in
 * the schema layer, not here — canonicalization must never change meaning.
 */
export class CanonicalizationError extends Error {}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalizationError("non-finite number");
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value
          .map((item) => {
            if (item === undefined) throw new CanonicalizationError("undefined array item");
            return canonicalize(item);
          })
          .join(",")}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalizationError("only plain objects can be canonicalized");
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => compareCodeUnits(a, b));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
    }
    default:
      throw new CanonicalizationError(`unsupported type: ${typeof value}`);
  }
}
