import type { Finding, FindingGroup } from '../core/finding.ts';
import { severityRank } from '../core/finding.ts';
import type { ReviewResult } from '../core/task.ts';

export const LINE_TOLERANCE = 2;

/**
 * Groups findings across reviewers by file + category + overlapping line range
 * (within LINE_TOLERANCE lines). The highest-severity finding becomes the group
 * representative. Shared by consensus strategies that only differ in how they
 * promote groups (e.g. overlap-v1, majority-v1).
 */
export function buildGroups(reviews: ReviewResult[]): FindingGroup[] {
  const all: Finding[] = reviews.flatMap((r) => r.findings);
  const groups: FindingGroup[] = [];

  let nextId = 1;
  for (const finding of all) {
    const target = groups.find((g) =>
      g.members.some((m) => matches(m, finding)),
    );
    if (target) {
      target.members.push(finding);
      if (!target.reviewers.includes(finding.reviewer)) {
        target.reviewers.push(finding.reviewer);
      }
      if (
        severityRank(finding.severity) >
        severityRank(target.representative.severity)
      ) {
        target.representative = finding;
      }
    } else {
      groups.push({
        id: `g${nextId++}`,
        representative: finding,
        members: [finding],
        reviewers: [finding.reviewer],
      });
    }
  }

  return groups;
}

function matches(a: Finding, b: Finding): boolean {
  if (a.file !== b.file) return false;
  if (a.category !== b.category) return false;
  return rangesOverlap(
    a.lineRange.start,
    a.lineRange.end,
    b.lineRange.start,
    b.lineRange.end,
  );
}

function rangesOverlap(
  a1: number,
  a2: number,
  b1: number,
  b2: number,
): boolean {
  const lo1 = a1 - LINE_TOLERANCE;
  const hi1 = a2 + LINE_TOLERANCE;
  return !(b2 < lo1 || b1 > hi1);
}
