/**
 * Global daily spend caps for the AI path (S2 + the Nebius credit ceiling).
 * Counts model CALLS, billed TOKENS (prompt + completion, reasoning included)
 * and DOLLARS (priced per model tier from agent/etc/models.json) per UTC day.
 * In-memory: one API instance; several replicas each get their own cap
 * (see the private security review, R1/R15).
 *
 * A call only starts if its worst case still fits every cap: the phase's max
 * output plus a prompt allowance, priced at the chosen model's rates.
 */
export const PROMPT_ALLOWANCE = 600;

/**
 * Conservative prompt-size estimate for reserving budget before a call:
 * ~3 characters per token (English averages ~4) plus chat-template overhead.
 * A 4,000-char request is ~1,400 tokens, well over the flat allowance.
 */
export function estimatePromptTokens(systemPrompt: string, requestText: string): number {
  return Math.max(PROMPT_ALLOWANCE, Math.ceil((systemPrompt.length + requestText.length) / 3) + 64);
}

export class DailyBudget {
  private day = "";
  private calls = 0;
  private tokens = 0;
  private usd = 0;
  private heavy = 0;
  constructor(
    private readonly callLimit: number,
    private readonly tokenLimit: number,
    private readonly usdLimit: number = 0,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private roll() {
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.calls = 0;
      this.tokens = 0;
      this.usd = 0;
      this.heavy = 0;
    }
  }

  /** Whether a call costing at most `worstUsd` still fits today's dollar cap. */
  fitsUsd(worstUsd: number): boolean {
    this.roll();
    return this.usdLimit <= 0 || this.usd + worstUsd <= this.usdLimit;
  }

  /** Whether another heavy-tier call fits today's heavy cap. */
  heavyAvailable(maxPerDay: number): boolean {
    this.roll();
    return this.heavy < maxPerDay;
  }

  /**
   * Reserve one call capped at `maxTokens` output, `promptTokens` input and
   * `worstUsd`. False = over budget, don't call. `heavy` counts toward the heavy cap.
   */
  tryReserve(maxTokens: number, worstUsd = 0, promptTokens = PROMPT_ALLOWANCE, heavy = false): boolean {
    this.roll();
    if (this.callLimit > 0 && this.calls >= this.callLimit) return false;
    if (this.tokenLimit > 0 && this.tokens + maxTokens + promptTokens > this.tokenLimit) return false;
    if (!this.fitsUsd(worstUsd)) return false;
    this.calls++;
    if (heavy) this.heavy++;
    return true;
  }

  /** Record what the provider actually billed. */
  spend(tokens: number, usd = 0) {
    this.roll();
    this.tokens += Math.max(0, tokens);
    this.usd += Math.max(0, usd);
  }

  snapshot() {
    this.roll();
    return {
      day: this.day, calls: this.calls, heavy: this.heavy, tokens: this.tokens, usd: Number(this.usd.toFixed(6)),
      callLimit: this.callLimit, tokenLimit: this.tokenLimit, usdLimit: this.usdLimit,
    };
  }
}

/**
 * Per-client daily cap on AI requests (keyed like the rate limiter: socket IP,
 * or CF-Connecting-IP behind Cloudflare). Stops one client from using the whole
 * global budget and switching the AI off for everyone. Bounded memory: at most
 * `maxClients` keys per day; past that, unknown clients share one bucket.
 */
export class ClientQuota {
  private day = "";
  private counts = new Map<string, number>();
  constructor(
    private readonly perClient: number,
    private readonly now: () => Date = () => new Date(),
    private readonly maxClients = 10_000,
  ) {}

  tryTake(client: string): boolean {
    if (this.perClient <= 0) return true;
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.counts.clear();
    }
    const key = this.counts.has(client) || this.counts.size < this.maxClients ? client : "__overflow__";
    const n = this.counts.get(key) ?? 0;
    if (n >= this.perClient) return false;
    this.counts.set(key, n + 1);
    return true;
  }
}
