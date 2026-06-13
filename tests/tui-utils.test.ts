import { describe, expect, test } from 'bun:test';
import { extractPipelines, parseReportSummary } from '../src/ui/tui/utils.ts';
import type { QuorumConfig } from '../src/config/schema.ts';

const fullReport = `# 🧭 Quorum review — default

**3 reviewer(s)** · **12 finding(s)** · **5 agreement group(s)** · **1 single-reviewer finding(s)** · **0 error(s)** · **2.45s**

## 📊 Summary

| Severity | Findings |
| --- | ---: |
| 🔴 critical | 1 |
| 🟠 high | 2 |
| 🟡 medium | 3 |
| ⚪ low | 4 |

## 🔎 Findings by priority

_No findings._
`;

const partialReport = `# 🧭 Quorum review — default

**1 reviewer(s)** · **0 finding(s)** · **0 agreement group(s)** · **0 single-reviewer finding(s)** · **0 error(s)** · **0.12s**

## 📊 Summary

| Severity | Findings |
| --- | ---: |
| 🔴 critical | 0 |
| 🟠 high | 0 |
| 🟡 medium | 0 |
| ⚪ low | 0 |

## 💰 Token Usage

_No token usage data available._
`;

const reportNoSeverity = `# 🧭 Quorum review — default

**2 reviewer(s)** · **0 finding(s)** · **0 agreement group(s)** · **0 single-reviewer finding(s)** · **0 error(s)** · **0.50s**

## 📊 Summary

| Severity | Findings |
| --- | ---: |

## 🚨 Reviewer errors

- **reviewer1**: something went wrong
`;

describe('extractPipelines', () => {
  const baseConfig = (): QuorumConfig => ({
    version: 1,
    personas: {
      security: { description: 'Security review', system: 'Review security issues.' },
    },
    reviewers: {
      sec: {
        persona: 'security',
        provider: { type: 'openrouter', model: 'gpt-4', api_key: 'test' },
      },
    },
    pipelines: {
      default: { reviewers: ['sec'] },
    },
  });

  test('returns empty array for empty config', () => {
    const config: QuorumConfig = { version: 1, personas: {}, reviewers: {}, pipelines: {} };
    expect(extractPipelines(config)).toEqual([]);
  });

  test('extracts a single pipeline with one reviewer', () => {
    const result = extractPipelines(baseConfig());
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('default');
    expect(result[0]?.mode).toBe('sequential');
    expect(result[0]?.reviewerCount).toBe(1);
    expect(result[0]?.reviewers).toHaveLength(1);
    expect(result[0]?.reviewers[0]?.id).toBe('sec');
    expect(result[0]?.reviewers[0]?.persona).toBe('security');
    expect(result[0]?.reviewers[0]?.provider).toBe('openrouter');
    expect(result[0]?.reviewers[0]?.model).toBe('gpt-4');
    expect(result[0]?.consensus).toBeUndefined();
  });

  test('extracts multiple pipelines with parallel mode and consensus', () => {
    const config = baseConfig();
    config.pipelines.ci = {
      reviewers: ['sec'],
      parallel: true,
      consensus: { strategy: 'majority-v1' },
    };
    const result = extractPipelines(config);
    expect(result).toHaveLength(2);
    const ci = result.find((p) => p.id === 'ci');
    expect(ci?.mode).toBe('parallel');
    expect(ci?.consensus).toBe('majority-v1');
  });

  test('handles missing reviewer gracefully', () => {
    const config = baseConfig();
    config.pipelines.default.reviewers = ['sec', 'ghost'];
    const result = extractPipelines(config);
    expect(result[0]?.reviewerCount).toBe(2);
    expect(result[0]?.reviewers[1]?.id).toBe('ghost');
    expect(result[0]?.reviewers[1]?.persona).toBe('?');
    expect(result[0]?.reviewers[1]?.provider).toBe('?');
  });

  test('handles reviewer without model', () => {
    const config: QuorumConfig = {
      version: 1,
      personas: { sec: { description: 'd', system: 's' } },
      reviewers: { r: { persona: 'sec', provider: { type: 'openrouter', api_key: 'k' } } },
      pipelines: { default: { reviewers: ['r'] } },
    };
    const result = extractPipelines(config);
    expect(result[0]?.reviewers[0]?.model).toBeUndefined();
  });
});

describe('parseReportSummary', () => {
  test('parses full report with all metrics', async () => {
    const path = '/tmp/quorum-test-full-report.md';
    await Bun.write(path, fullReport);
    const result = await parseReportSummary(path);
    expect(result).toBeDefined();
    expect(result?.reviewerCount).toBe(3);
    expect(result?.findingCount).toBe(12);
    expect(result?.agreementCount).toBe(5);
    expect(result?.singleReviewerCount).toBe(1);
    expect(result?.errorCount).toBe(0);
    expect(result?.duration).toBe('2.45');
    expect(result?.severity).toEqual({
      critical: 1,
      high: 2,
      medium: 3,
      low: 4,
    });
  });

  test('parses report with zero values', async () => {
    const path = '/tmp/quorum-test-zero-report.md';
    await Bun.write(path, partialReport);
    const result = await parseReportSummary(path);
    expect(result).toBeDefined();
    expect(result?.reviewerCount).toBe(1);
    expect(result?.findingCount).toBe(0);
    expect(result?.agreementCount).toBe(0);
    expect(result?.singleReviewerCount).toBe(0);
    expect(result?.errorCount).toBe(0);
    expect(result?.duration).toBe('0.12');
    expect(result?.severity).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    });
  });

  test('parses report with metric rows but no severity rows', async () => {
    const path = '/tmp/quorum-test-no-severity.md';
    await Bun.write(path, reportNoSeverity);
    const result = await parseReportSummary(path);
    expect(result).toBeDefined();
    expect(result?.reviewerCount).toBe(2);
    expect(result?.severity).toEqual({});
  });

  test('returns undefined for nonexistent file', async () => {
    const result = await parseReportSummary('/tmp/quorum-test-nonexistent.md');
    expect(result).toBeUndefined();
  });
});
