import type { ConsensusResult, SemanticV2ConsensusConfig } from '../core/pipeline.ts';
import type { ConsensusStrategy } from './registry.ts';
import { buildSemanticGroups } from './grouping-v2.ts';
import { detectContradictions } from './contradictions.ts';
import { resolveContradictions } from './meta-reviewer.ts';

const DEFAULT_THRESHOLD = 0.6;

export const semanticV2: ConsensusStrategy<SemanticV2ConsensusConfig> = {
  id: 'semantic-v2',
  async aggregate(reviews, cfg, ctx): Promise<ConsensusResult> {
    const threshold = cfg.similarityThreshold ?? DEFAULT_THRESHOLD;
    const groups = buildSemanticGroups(reviews, { similarityThreshold: threshold });

    const agreement: Record<string, number> = {};
    for (const g of groups) agreement[g.id] = g.reviewers.length;

    const requireAgreement = cfg.requireAgreement ?? 1;
    const passing = groups.filter((g) => g.reviewers.length >= requireAgreement);
    const unique = groups
      .filter((g) => g.reviewers.length < requireAgreement)
      .flatMap((g) => g.members);

    let contradictions: ConsensusResult['contradictions'] = [];
    if (cfg.enableContradictions) {
      contradictions = detectContradictions(passing.length > 0 ? passing : groups);
      if (contradictions.length > 0 && ctx?.metaReview) {
        contradictions = await resolveContradictions(
          contradictions,
          passing.length > 0 ? passing : groups,
          ctx.metaReview,
        );
      }
    }

    return {
      groups: passing,
      agreement,
      unique,
      contradictions,
      strategyId: 'semantic-v2',
    };
  },
};
