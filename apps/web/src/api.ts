import type { CommitmentOpening, Evaluation, PublicKeyEntry, RightsPolicy, SignedReceipt, UseRequest } from "@nextplay/core";

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export interface AIInfo {
  status: "ok" | "disabled" | "error" | "not_used";
  model?: string;
  reason?: string;
  latencyMs?: number;
  confidence?: number;
  missingInformation?: string[];
  ambiguities?: string[];
  explanation?: string;
}

export interface CheckResult {
  decision: Evaluation["decision"];
  evaluation: Evaluation | null;
  /** What the decision is bound to. Only "structured_terms" is final. */
  basis?: "structured_terms" | "ai_extraction" | "injection_prescan";
  reviews?: string[];
  extractedRequest?: UseRequest;
  /** Present on AI-derived ALLOWED: the requester must confirm these exact terms. */
  confirmation?: { required: true; terms: UseRequest } | { required: false };
  ai: AIInfo;
  advisory?: string;
  /** C2: signed by the API. Untrusted until verified against /api/v1/keys. */
  receipt?: SignedReceipt;
  requestOpening?: CommitmentOpening;
}

/** Opening of the policy seal, so the API can bind its receipt to the sealed commitment. */
export interface PolicySeal {
  commitment: string;
  salt: string;
}

/** The AI path is out of budget or offline: the caller should switch to the form. */
export class UseFormError extends Error {}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the rights API. Start it with `npm run dev:api` and try again.");
  }
  if (res.status === 429) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === "ai_client_quota_reached") throw new UseFormError("You've used today's automatic readings. Fill in the details instead.");
    throw new Error("Too many checks in a minute. Wait a moment and try again.");
  }
  if (res.status === 503) throw new UseFormError("Automatic reading is paused for today. Fill in the details instead.");
  if (!res.ok) throw new Error(`The API rejected this request (${res.status}). Check the policy and request fields.`);
  return (await res.json()) as T;
}

export function analyze(policy: RightsPolicy, requestText: string, policySeal: PolicySeal): Promise<CheckResult> {
  return post<CheckResult>("/api/v1/rights/analyze", { policy, requestText, policySeal });
}

export async function evaluateStructured(policy: RightsPolicy, request: UseRequest, policySeal: PolicySeal): Promise<CheckResult> {
  const r = await post<Pick<CheckResult, "evaluation" | "ai" | "receipt" | "requestOpening"> & { evaluation: Evaluation }>(
    "/api/v1/rights/evaluate",
    { policy, request, policySeal },
  );
  return { ...r, decision: r.evaluation.decision, basis: "structured_terms", extractedRequest: request };
}

let keysCache: Promise<PublicKeyEntry[]> | null = null;
/** Receipt verification keys, fetched once per page load. */
export function receiptKeys(): Promise<PublicKeyEntry[]> {
  keysCache ??= fetch(`${BASE}/api/v1/keys`)
    .then((r) => (r.ok ? (r.json() as Promise<{ keys: PublicKeyEntry[] }>) : { keys: [] }))
    .then((b) => b.keys)
    .catch(() => {
      keysCache = null;
      return [];
    });
  return keysCache;
}

export async function health(): Promise<{ ai: "enabled" | "disabled" } | null> {
  try {
    const res = await fetch(`${BASE}/health`);
    return res.ok ? ((await res.json()) as { ai: "enabled" | "disabled" }) : null;
  } catch {
    return null;
  }
}
