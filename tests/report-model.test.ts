import { describe, expect, test } from 'bun:test';
import type { Finding } from '../src/core/finding.ts';
import type { PipelineResult } from '../src/core/pipeline.ts';
import {
  categoryIcon,
  collectJsonReportFindings,
  countBySeverity,
  formatDuration,
  severityIcon,
  toJsonReport,
} from '../src/ui/report-model.ts';

describe('report-model', () => {
  test('builds JSON reports with agreement counts and deduplicates report findings', () => {
    const shared = finding({ reviewer: 'sec-a', severity: 'high' });
    const paired = finding({
      reviewer: 'sec-b',
      severity: 'high',
      lineStart: 11,
    });
    const unique = finding({
      reviewer: 'arch',
      file: 'src/arch.ts',
      severity: 'low',
    });
    const result: PipelineResult = {
      pipelineId: 'default',
      reviews: [
        review('sec-a', [shared]),
        review('sec-b', [paired]),
        review('arch', [unique]),
      ],
      consensus: {
        strategyId: 'overlap-v1',
        groups: [
          {
            id: 'group-1',
            representative: shared,
            members: [shared, paired],
            reviewers: ['sec-a', 'sec-b'],
          },
        ],
        agreement: { 'group-1': 2 },
        unique: [unique],
        contradictions: [],
      },
      durationMs: 1250,
      errors: [],
    };

    const report = toJsonReport(result);
    expect(report.consensus.groups[0]?.agreement).toBe(2);
    expect(
      collectJsonReportFindings(report).map(({ finding }) => finding),
    ).toEqual([shared, paired, unique]);
  });

  test('shares glyphs, duration, and severity counts', () => {
    const findings = [
      finding({ reviewer: 'a', severity: 'critical', category: 'security' }),
      finding({ reviewer: 'b', severity: 'low', category: 'style' }),
    ];

    expect(severityIcon('critical')).toBe('🚨');
    expect(categoryIcon('security')).toBe('🔐');
    expect(formatDuration(999)).toBe('999ms');
    expect(formatDuration(1250)).toBe('1.3s');
    expect(countBySeverity(findings)).toMatchObject({
      critical: 1,
      low: 1,
      high: 0,
    });
  });
});

function review(
  reviewerId: string,
  findings: Finding[],
): PipelineResult['reviews'][number] {
  return {
    taskId: `task:${reviewerId}`,
    reviewerId,
    findings,
    rawOutput: JSON.stringify({ findings: [] }),
    durationMs: 1,
  };
}

function finding(opts: {
  reviewer: string;
  file?: string;
  lineStart?: number;
  severity?: Finding['severity'];
  category?: Finding['category'];
}): Finding {
  const start = opts.lineStart ?? 10;
  return {
    file: opts.file ?? 'src/app.ts',
    lineRange: { start, end: start },
    severity: opts.severity ?? 'medium',
    category: opts.category ?? 'correctness',
    title: 'Shared issue',
    body: 'Issue body',
    reviewer: opts.reviewer,
  };
}
