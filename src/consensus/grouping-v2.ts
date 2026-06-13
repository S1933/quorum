import type { FindingGroup } from '../core/finding.ts';
import { severityRank } from '../core/finding.ts';
import type { ReviewResult } from '../core/task.ts';
import { buildGroups } from './grouping.ts';
import { findingSimilarity } from './similarity.ts';

const DEFAULT_SIMILARITY_THRESHOLD = 0.6;

export interface SemanticGroupingOptions {
  similarityThreshold?: number;
}

export function buildSemanticGroups(
  reviews: ReviewResult[],
  opts?: SemanticGroupingOptions,
): FindingGroup[] {
  const threshold = opts?.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const groups = buildGroups(reviews);

  if (groups.length <= 1) return groups;

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < groups.length; i++) {
      const a = groups[i];
      if (!a) continue;
      for (let j = i + 1; j < groups.length; j++) {
        const b = groups[j];
        if (!b) continue;
        if (
          findingSimilarity(a.representative, b.representative) >= threshold
        ) {
          a.members.push(...b.members);
          for (const reviewer of b.reviewers) {
            if (!a.reviewers.includes(reviewer)) {
              a.reviewers.push(reviewer);
            }
          }
          if (
            severityRank(a.representative.severity) <
            severityRank(b.representative.severity)
          ) {
            a.representative = b.representative;
          }
          groups[j] = undefined as unknown as FindingGroup;
          changed = true;
        }
      }
    }
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i] === undefined) groups.splice(i, 1);
    }
  }

  return groups;
}
