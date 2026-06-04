import type { Finding, FindingGroup } from '../core/finding.ts';
import type { ConsensusResult } from '../core/pipeline.ts';
import { LINE_TOLERANCE } from './grouping.ts';

type Contradiction = ConsensusResult['contradictions'][number];

export function detectContradictions(groups: FindingGroup[]): Contradiction[] {
  const contradictions: Contradiction[] = [];

  for (const group of groups) {
    const members = group.members;
    if (members.length < 2) continue;

    for (let i = 0; i < members.length; i++) {
      const a = members[i];
      if (!a) continue;
      for (let j = i + 1; j < members.length; j++) {
        const b = members[j];
        if (!b) continue;

        if (!sameFileAndOverlap(a, b)) continue;

        const sevGap = severityGap(a.severity, b.severity);
        if (sevGap >= 2) {
          contradictions.push({
            groupId: group.id,
            reviewerA: a.reviewer,
            reviewerB: b.reviewer,
            note: `Reviewer ${a.reviewer} rated this ${a.severity}, Reviewer ${b.reviewer} rated it ${b.severity} — significant severity disagreement`,
          });
          continue;
        }

        if (a.category !== b.category) {
          contradictions.push({
            groupId: group.id,
            reviewerA: a.reviewer,
            reviewerB: b.reviewer,
            note: `Reviewer ${a.reviewer} classified as ${a.category}, Reviewer ${b.reviewer} classified as ${b.category}`,
          });
        }
      }
    }
  }

  return contradictions;
}

function severityGap(a: string, b: string): number {
  const ranks: Record<string, number> = {
    info: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  return Math.abs((ranks[a] ?? 0) - (ranks[b] ?? 0));
}

function sameFileAndOverlap(a: Finding, b: Finding): boolean {
  if (a.file !== b.file) return false;
  const lo1 = a.lineRange.start - LINE_TOLERANCE;
  const hi1 = a.lineRange.end + LINE_TOLERANCE;
  return !(b.lineRange.end < lo1 || b.lineRange.start > hi1);
}
