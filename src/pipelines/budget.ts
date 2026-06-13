import type { UsageInfo } from '../core/task.ts';

export interface BudgetLimits {
  maxTotalCostUsd?: number;
}

export interface BudgetState {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  exceeded: boolean;
  reason?: string;
}

export class BudgetTracker {
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCostUsd = 0;
  private exceeded = false;
  private reason?: string;

  constructor(private readonly limits: BudgetLimits) {}

  record(usage?: UsageInfo): BudgetState {
    if (!usage) return this.state();

    this.totalInputTokens += usage.inputTokens;
    this.totalOutputTokens += usage.outputTokens;
    if (usage.costUsd) this.totalCostUsd += usage.costUsd;

    if (
      !this.exceeded &&
      this.limits.maxTotalCostUsd !== undefined &&
      this.totalCostUsd > this.limits.maxTotalCostUsd
    ) {
      this.exceeded = true;
      this.reason = `Cost limit exceeded: $${this.totalCostUsd.toFixed(4)} spent, limit $${this.limits.maxTotalCostUsd.toFixed(2)}`;
    }

    return this.state();
  }

  state(): BudgetState {
    const state: BudgetState = {
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCostUsd: this.totalCostUsd,
      exceeded: this.exceeded,
    };
    if (this.reason !== undefined) state.reason = this.reason;
    return state;
  }

  get isExceeded(): boolean {
    return this.exceeded;
  }
}
