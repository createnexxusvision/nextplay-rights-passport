import type { Evaluation, RightsPolicy, UseRequest } from "@nextplay/core";

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
  if (res.status === 429) throw new Error("Too many checks in a minute. Wait a moment and try again.");
  if (res.status === 503) throw new UseFormError("Automatic reading is paused for today. Fill in the details instead.");
  if (!res.ok) throw new Error(`The API rejected this request (${res.status}). Check the policy and request fields.`);
  return (await res.json()) as T;
}

export function analyze(policy: RightsPolicy, requestText: string): Promise<CheckResult> {
  return post<CheckResult>("/api/v1/rights/analyze", { policy, requestText });
}

export async function evaluateStructured(policy: RightsPolicy, request: UseRequest): Promise<CheckResult> {
  const r = await post<{ evaluation: Evaluation; ai: AIInfo }>("/api/v1/rights/evaluate", { policy, request });
  return { decision: r.evaluation.decision, evaluation: r.evaluation, basis: "structured_terms", ai: r.ai, extractedRequest: request };
}

export async function health(): Promise<{ ai: "enabled" | "disabled" } | null> {
  try {
    const res = await fetch(`${BASE}/health`);
    return res.ok ? ((await res.json()) as { ai: "enabled" | "disabled" }) : null;
  } catch {
    return null;
  }
}
