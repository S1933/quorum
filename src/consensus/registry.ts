import type { ReviewResult } from '../core/task.ts';
import type { ConsensusResult, ConsensusConfig } from '../core/pipeline.ts';
import { ConfigError } from '../core/errors.ts';

export type MetaReviewFn = (prompt: string) => Promise<string>;

export interface ConsensusContext {
  metaReview?: MetaReviewFn;
}

export interface ConsensusStrategy {
  id: string;
  aggregate(
    reviews: ReviewResult[],
    cfg: ConsensusConfig,
    ctx?: ConsensusContext,
  ): ConsensusResult | Promise<ConsensusResult>;
}

export class ConsensusRegistry {
  private readonly strategies = new Map<string, ConsensusStrategy>();

  register(s: ConsensusStrategy): void {
    if (this.strategies.has(s.id)) {
      throw new ConfigError(`Consensus strategy "${s.id}" already registered`);
    }
    this.strategies.set(s.id, s);
  }

  resolve(id: string): ConsensusStrategy {
    const s = this.strategies.get(id);
    if (!s) {
      throw new ConfigError(
        `Unknown consensus strategy "${id}". Available: ${[...this.strategies.keys()].join(', ') || '(none)'}`,
      );
    }
    return s;
  }
}
