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

export class DailyBudget {
  private day = "";
  private calls = 0;
  private tokens = 0;
  private usd = 0;
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
    }
  }

  /** Whether a call costing at most `worstUsd` still fits today's dollar cap. */
  fitsUsd(worstUsd: number): boolean {
    this.roll();
    return this.usdLimit <= 0 || this.usd + worstUsd <= this.usdLimit;
  }

  /** Reserve one call capped at `maxTokens` output and `worstUsd`. False = over budget, don't call. */
  tryReserve(maxTokens: number, worstUsd = 0): boolean {
    this.roll();
    if (this.callLimit > 0 && this.calls >= this.callLimit) return false;
    if (this.tokenLimit > 0 && this.tokens + maxTokens + PROMPT_ALLOWANCE > this.tokenLimit) return false;
    if (!this.fitsUsd(worstUsd)) return false;
    this.calls++;
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
      day: this.day, calls: this.calls, tokens: this.tokens, usd: Number(this.usd.toFixed(6)),
      callLimit: this.callLimit, tokenLimit: this.tokenLimit, usdLimit: this.usdLimit,
    };
  }
}
