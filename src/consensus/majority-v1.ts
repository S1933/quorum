import type { ConsensusResult } from '../core/pipeline.ts';
import type { ConsensusStrategy } from './registry.ts';
import { buildGroups } from './grouping.ts';

/**
 * Promotes a finding group when a strict majority of the reviewers that actually
 * produced a result agree on it (> half). The threshold is derived dynamically
 * from the reviewer count, so it stays robust as reviewers are added or removed.
 *
 * The threshold never drops below 2: with a single surviving reviewer the
 * majority would be 1, which would auto-promote every finding as "consensus"
 * (e.g. when all-but-one reviewer times out). An optional `requireAgreement`
 * raises this floor further.
 */
export const majorityV1: ConsensusStrategy = {
  id: 'majority-v1',
  aggregate(reviews, cfg): ConsensusResult {
    const groups = buildGroups(reviews);

    const agreement: Record<string, number> = {};
    for (const g of groups) agreement[g.id] = g.reviewers.length;

    const majority = Math.floor(reviews.length / 2) + 1;
    const threshold = Math.max(majority, cfg.requireAgreement ?? 2);

    const groupsOut = groups.filter((g) => g.reviewers.length >= threshold);
    const unique = groups
      .filter((g) => g.reviewers.length < threshold)
      .flatMap((g) => g.members);

    return {
      groups: groupsOut,
      agreement,
      unique,
      contradictions: [],
      strategyId: 'majority-v1',
    };
  },
};
