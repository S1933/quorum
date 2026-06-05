import type { ConsensusResult, OverlapV1ConsensusConfig } from '../core/pipeline.ts';
import type { ConsensusStrategy } from './registry.ts';
import { buildGroups } from './grouping.ts';

export const overlapV1: ConsensusStrategy<OverlapV1ConsensusConfig> = {
  id: 'overlap-v1',
  aggregate(reviews, cfg): ConsensusResult {
    const groups = buildGroups(reviews);

    const agreement: Record<string, number> = {};
    for (const g of groups) agreement[g.id] = g.reviewers.length;

    const requireAgreement = cfg.requireAgreement ?? 1;
    const passing = groups.filter((g) => g.reviewers.length >= requireAgreement);
    const unique = groups
      .filter((g) => g.reviewers.length < requireAgreement && requireAgreement > 1)
      .flatMap((g) => g.members);

    const finalGroups =
      requireAgreement > 1
        ? passing
        : groups.filter((g) => g.reviewers.length >= 2);
    const finalUnique =
      requireAgreement > 1
        ? unique
        : groups.filter((g) => g.reviewers.length < 2).flatMap((g) => g.members);

    return {
      groups: finalGroups,
      agreement,
      unique: finalUnique,
      contradictions: [],
      strategyId: 'overlap-v1',
    };
  },
};
