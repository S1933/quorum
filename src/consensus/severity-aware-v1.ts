import type { ConsensusResult } from '../core/pipeline.ts';
import type { Severity } from '../core/finding.ts';
import type { ConsensusStrategy } from './registry.ts';
import { buildGroups } from './grouping.ts';

/**
 * Promotion thresholds keyed by the group's representative (highest) severity.
 * The more severe a finding is, the fewer reviewers need to agree before it is
 * surfaced as consensus: a critical/high issue is worth promoting even from a
 * single reviewer, while low-severity noise must clear a broader agreement bar.
 */
export const DEFAULT_SEVERITY_THRESHOLDS: Record<Severity, number> = {
  critical: 1,
  high: 1,
  medium: 2,
  low: 3,
  info: 3,
};

/**
 * Severity-aware consensus: the agreement threshold scales inversely with the
 * severity of the group's representative finding (see DEFAULT_SEVERITY_THRESHOLDS).
 *
 * Unlike majority-v1, this strategy intentionally promotes a lone reviewer's
 * critical/high finding — the cost of dropping a real critical issue outweighs
 * the noise of an occasional false positive. Lower-severity groups still require
 * corroboration to be promoted.
 *
 * `requireAgreement` acts as a global floor applied to every severity, so a user
 * can demand corroboration even for critical findings (e.g. requireAgreement: 2).
 * Per-severity overrides can be supplied via `cfg.severityThresholds`.
 */
export const severityAwareV1: ConsensusStrategy = {
  id: 'severity-aware-v1',
  aggregate(reviews, cfg): ConsensusResult {
    const groups = buildGroups(reviews);

    const agreement: Record<string, number> = {};
    for (const g of groups) agreement[g.id] = g.reviewers.length;

    const overrides = (cfg.severityThresholds as Partial<Record<Severity, number>> | undefined) ?? {};
    const floor = cfg.requireAgreement ?? 1;
    const thresholdFor = (severity: Severity): number => {
      const base = overrides[severity] ?? DEFAULT_SEVERITY_THRESHOLDS[severity];
      return Math.max(base, floor);
    };

    const promoted = (groupSeverity: Severity, reviewerCount: number): boolean =>
      reviewerCount >= thresholdFor(groupSeverity);

    const groupsOut = groups.filter((g) =>
      promoted(g.representative.severity, g.reviewers.length),
    );
    const unique = groups
      .filter((g) => !promoted(g.representative.severity, g.reviewers.length))
      .flatMap((g) => g.members);

    return {
      groups: groupsOut,
      agreement,
      unique,
      contradictions: [],
      strategyId: 'severity-aware-v1',
    };
  },
};
