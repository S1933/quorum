import type { Finding, FindingGroup, Severity } from '../core/finding.ts';
import type { PipelineResult, ReviewerError } from '../core/pipeline.ts';

export const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

const SEVERITY_ICON: Record<Severity, string> = {
  critical: '🚨',
  high: '🔥',
  medium: '⚠️',
  low: '🧊',
  info: 'ℹ️',
};

const CATEGORY_ICON: Record<Finding['category'], string> = {
  security: '🔐',
  performance: '⚡',
  architecture: '🏗️',
  correctness: '✅',
  style: '🎨',
};

export interface JsonReport {
  schemaVersion: 1;
  pipeline: {
    id: string;
    durationMs: number;
    reviewCount: number;
    errorCount: number;
  };
  reviews: Array<{
    taskId: string;
    reviewerId: string;
    durationMs: number;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      costUsd?: number;
    };
    findings: Finding[];
  }>;
  consensus: {
    strategyId: string;
    groups: Array<FindingGroup & { agreement: number }>;
    unique: Finding[];
    contradictions: PipelineResult['consensus']['contradictions'];
  };
  errors: Array<Pick<ReviewerError, 'reviewerId' | 'message'>>;
}

export interface ReportFinding {
  finding: Finding;
  agreement?: number;
  groupId?: string;
}

export interface SeverityBucket {
  severity: Severity;
  groups: FindingGroup[];
  unique: Finding[];
  count: number;
}

export function severityIcon(severity: Severity): string {
  return SEVERITY_ICON[severity];
}

export function categoryIcon(category: Finding['category']): string {
  return CATEGORY_ICON[category];
}

export function severityLabel(severity: Severity): string {
  return severity[0]!.toUpperCase() + severity.slice(1);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function collectPipelineFindings(groups: FindingGroup[], unique: Finding[]): Finding[] {
  return [...groups.flatMap((group) => group.members), ...unique];
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts = Object.fromEntries(SEVERITY_ORDER.map((severity) => [severity, 0])) as Record<Severity, number>;
  for (const finding of findings) counts[finding.severity]++;
  return counts;
}

export function buildSeverityBuckets(groups: FindingGroup[], unique: Finding[]): SeverityBucket[] {
  return SEVERITY_ORDER.map((severity) => {
    const severityGroups = groups
      .filter((group) => group.representative.severity === severity)
      .sort((a, b) => b.reviewers.length - a.reviewers.length);
    const severityUnique = unique.filter((finding) => finding.severity === severity);
    return {
      severity,
      groups: severityGroups,
      unique: severityUnique,
      count: severityGroups.length + severityUnique.length,
    };
  });
}

export function toJsonReport(result: PipelineResult): JsonReport {
  return {
    schemaVersion: 1,
    pipeline: {
      id: result.pipelineId,
      durationMs: result.durationMs,
      reviewCount: result.reviews.length,
      errorCount: result.errors.length,
    },
    reviews: result.reviews.map((review) => {
      const out: JsonReport['reviews'][number] = {
        taskId: review.taskId,
        reviewerId: review.reviewerId,
        durationMs: review.durationMs,
        findings: review.findings,
      };
      if (review.usage) out.usage = review.usage;
      return out;
    }),
    consensus: {
      strategyId: result.consensus.strategyId,
      groups: result.consensus.groups.map((group) => ({
        ...group,
        agreement: result.consensus.agreement[group.id] ?? group.reviewers.length,
      })),
      unique: result.consensus.unique,
      contradictions: result.consensus.contradictions,
    },
    errors: result.errors.map((error) => ({
      reviewerId: error.reviewerId,
      message: error.message,
    })),
  };
}

export function collectJsonReportFindings(report: JsonReport): ReportFinding[] {
  const seen = new Set<string>();
  const out: ReportFinding[] = [];

  for (const group of report.consensus.groups) {
    for (const finding of group.members) {
      const key = dedupKey(finding);
      seen.add(key);
      out.push({ finding, agreement: group.agreement, groupId: group.id });
    }
  }

  for (const review of report.reviews) {
    for (const finding of review.findings) {
      const key = dedupKey(finding);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ finding });
      }
    }
  }

  for (const finding of report.consensus.unique) {
    const key = dedupKey(finding);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ finding });
    }
  }

  return out;
}

function dedupKey(finding: Finding): string {
  return [
    finding.reviewer,
    finding.file,
    finding.lineRange.start,
    finding.lineRange.end,
    finding.severity,
    finding.title,
  ].join('\x00');
}
