/**
 * Global daily spend caps for the AI path (S2 + the Nebius credit ceiling).
 * Counts model CALLS and billed TOKENS (prompt + completion, reasoning
 * included) per UTC day. In-memory: one API instance; several replicas each
 * get their own cap (see the private security review, R1).
 *
 * A call is only started if the worst case still fits: tokens used so far plus
 * that phase's max output plus a prompt allowance must stay under the budget.
 */
export const PROMPT_ALLOWANCE = 600;

export class DailyBudget {
  private day = "";
  private calls = 0;
  private tokens = 0;
  constructor(
    private readonly callLimit: number,
    private readonly tokenLimit: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private roll() {
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.calls = 0;
      this.tokens = 0;
    }
  }

  /** Reserve one call whose output is capped at `maxTokens`. False = over budget, don't call. */
  tryReserve(maxTokens: number): boolean {
    this.roll();
    if (this.callLimit > 0 && this.calls >= this.callLimit) return false;
    if (this.tokenLimit > 0 && this.tokens + maxTokens + PROMPT_ALLOWANCE > this.tokenLimit) return false;
    this.calls++;
    return true;
  }

  /** Record what the provider actually billed. */
  spend(tokens: number) {
    this.roll();
    this.tokens += Math.max(0, tokens);
  }

  snapshot() {
    this.roll();
    return { day: this.day, calls: this.calls, tokens: this.tokens, callLimit: this.callLimit, tokenLimit: this.tokenLimit };
  }
}
