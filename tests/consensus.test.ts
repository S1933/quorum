import { describe, expect, test } from 'bun:test';
import { detectContradictions } from '../src/consensus/contradictions.ts';
import { buildSemanticGroups } from '../src/consensus/grouping-v2.ts';
import { majorityV1 } from '../src/consensus/majority-v1.ts';
import { overlapV1 } from '../src/consensus/overlap-v1.ts';
import { semanticV2 } from '../src/consensus/semantic-v2.ts';
import { severityAwareV1 } from '../src/consensus/severity-aware-v1.ts';
import {
  findingSimilarity,
  textToBigrams,
} from '../src/consensus/similarity.ts';
import type { Category, Finding, Severity } from '../src/core/finding.ts';
import type { ReviewResult } from '../src/core/task.ts';

describe('overlap-v1', () => {
  test('keeps only groups that satisfy requireAgreement and returns non-passing findings as unique', async () => {
    const agreedA = finding({ reviewer: 'sec-a', lineStart: 10 });
    const agreedB = finding({ reviewer: 'sec-b', lineStart: 11 });
    const single = finding({
      reviewer: 'sec-c',
      file: 'src/other.ts',
      lineStart: 40,
      title: 'Only one reviewer saw this',
    });

    const result = await overlapV1.aggregate(
      [
        review('sec-a', [agreedA]),
        review('sec-b', [agreedB]),
        review('sec-c', [single]),
      ],
      { strategy: 'overlap-v1', requireAgreement: 2 },
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.reviewers).toEqual(['sec-a', 'sec-b']);
    expect(result.groups[0]?.members).toEqual([agreedA, agreedB]);
    expect(result.unique).toEqual([single]);
  });

  test('groups line ranges that are within the two-line tolerance', async () => {
    const first = finding({ reviewer: 'arch-a', lineStart: 20, lineEnd: 22 });
    const second = finding({ reviewer: 'arch-b', lineStart: 24, lineEnd: 25 });

    const result = await overlapV1.aggregate(
      [review('arch-a', [first]), review('arch-b', [second])],
      { strategy: 'overlap-v1' },
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.members).toEqual([first, second]);
    expect(result.unique).toEqual([]);
  });

  test('does not group findings with different categories even when file and lines overlap', async () => {
    const security = finding({
      reviewer: 'sec',
      category: 'security',
      lineStart: 12,
    });
    const correctness = finding({
      reviewer: 'correctness',
      category: 'correctness',
      lineStart: 13,
    });

    const result = await overlapV1.aggregate(
      [review('sec', [security]), review('correctness', [correctness])],
      { strategy: 'overlap-v1' },
    );

    expect(result.groups).toEqual([]);
    expect(result.unique).toEqual([security, correctness]);
  });

  test('groups findings regardless of iteration order via member matching', async () => {
    const a = finding({
      reviewer: 'r-a',
      lineStart: 10,
      lineEnd: 12,
      severity: 'low',
      title: 'A',
    });
    const b = finding({
      reviewer: 'r-b',
      lineStart: 12,
      lineEnd: 14,
      severity: 'critical',
      title: 'B',
    });
    const c = finding({
      reviewer: 'r-c',
      lineStart: 10,
      lineEnd: 11,
      severity: 'medium',
      title: 'C',
    });

    const result = await overlapV1.aggregate(
      [review('r-a', [a]), review('r-b', [b]), review('r-c', [c])],
      { strategy: 'overlap-v1' },
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.members).toHaveLength(3);
    expect(result.groups[0]?.reviewers.sort()).toEqual(['r-a', 'r-b', 'r-c']);
  });

  test('uses the highest severity finding as the group representative', async () => {
    const low = finding({
      reviewer: 'perf-a',
      severity: 'low',
      title: 'Low severity version',
    });
    const critical = finding({
      reviewer: 'perf-b',
      severity: 'critical',
      title: 'Critical severity version',
      lineStart: 9,
    });
    const medium = finding({
      reviewer: 'perf-c',
      severity: 'medium',
      title: 'Medium severity version',
      lineStart: 11,
    });

    const result = await overlapV1.aggregate(
      [
        review('perf-a', [low]),
        review('perf-b', [critical]),
        review('perf-c', [medium]),
      ],
      { strategy: 'overlap-v1' },
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.representative).toBe(critical);
    expect(result.groups[0]?.reviewers).toEqual(['perf-a', 'perf-b', 'perf-c']);
  });
});

describe('majority-v1', () => {
  test('promotes a group backed by a strict majority and drops the lone finding into unique', async () => {
    const agreedA = finding({ reviewer: 'a', lineStart: 10 });
    const agreedB = finding({ reviewer: 'b', lineStart: 11 });
    const single = finding({
      reviewer: 'c',
      file: 'src/other.ts',
      lineStart: 40,
      title: 'Only one reviewer saw this',
    });

    const result = await majorityV1.aggregate(
      [review('a', [agreedA]), review('b', [agreedB]), review('c', [single])],
      { strategy: 'majority-v1' },
    );

    // 3 reviewers -> threshold 2
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.reviewers).toEqual(['a', 'b']);
    expect(result.unique).toEqual([single]);
    expect(result.strategyId).toBe('majority-v1');
  });

  test('requires unanimity when only two reviewers ran', async () => {
    const a = finding({ reviewer: 'a', file: 'src/a.ts', lineStart: 10 });
    const b = finding({ reviewer: 'b', file: 'src/b.ts', lineStart: 50 });

    const result = await majorityV1.aggregate(
      [review('a', [a]), review('b', [b])],
      { strategy: 'majority-v1' },
    );

    // 2 reviewers -> threshold 2, neither group reaches it
    expect(result.groups).toEqual([]);
    expect(result.unique).toEqual([a, b]);
  });

  test('promotes a group when both of two reviewers agree (unanimity)', async () => {
    const a = finding({ reviewer: 'a', lineStart: 10 });
    const b = finding({ reviewer: 'b', lineStart: 11 });

    const result = await majorityV1.aggregate(
      [review('a', [a]), review('b', [b])],
      { strategy: 'majority-v1' },
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.reviewers).toEqual(['a', 'b']);
    expect(result.unique).toEqual([]);
  });

  test('two of four reviewers is not a majority, three of five is', async () => {
    const twoOfFour = await majorityV1.aggregate(
      [
        review('a', [finding({ reviewer: 'a', lineStart: 10 })]),
        review('b', [finding({ reviewer: 'b', lineStart: 11 })]),
        review('c', [
          finding({ reviewer: 'c', file: 'src/x.ts', lineStart: 80 }),
        ]),
        review('d', [
          finding({ reviewer: 'd', file: 'src/y.ts', lineStart: 90 }),
        ]),
      ],
      { strategy: 'majority-v1' },
    );
    // 4 reviewers -> threshold 3
    expect(twoOfFour.groups).toEqual([]);

    const threeOfFive = await majorityV1.aggregate(
      [
        review('a', [finding({ reviewer: 'a', lineStart: 10 })]),
        review('b', [finding({ reviewer: 'b', lineStart: 11 })]),
        review('c', [finding({ reviewer: 'c', lineStart: 12 })]),
        review('d', [
          finding({ reviewer: 'd', file: 'src/x.ts', lineStart: 80 }),
        ]),
        review('e', [
          finding({ reviewer: 'e', file: 'src/y.ts', lineStart: 90 }),
        ]),
      ],
      { strategy: 'majority-v1' },
    );
    // 5 reviewers -> threshold 3
    expect(threeOfFive.groups).toHaveLength(1);
    expect(threeOfFive.groups[0]?.reviewers).toEqual(['a', 'b', 'c']);
  });

  test('never auto-promotes findings when only one reviewer ran (floor of 2)', async () => {
    const a = finding({ reviewer: 'a', lineStart: 10 });
    const b = finding({ reviewer: 'a', lineStart: 50, file: 'src/b.ts' });

    const result = await majorityV1.aggregate([review('a', [a, b])], {
      strategy: 'majority-v1',
    });

    // 1 reviewer -> majority would be 1, but the floor of 2 blocks promotion
    expect(result.groups).toEqual([]);
    expect(result.unique).toEqual([a, b]);
  });

  test('uses the highest severity finding as the group representative', async () => {
    const low = finding({ reviewer: 'a', severity: 'low', title: 'Low' });
    const critical = finding({
      reviewer: 'b',
      severity: 'critical',
      title: 'Critical',
      lineStart: 9,
    });
    const medium = finding({
      reviewer: 'c',
      severity: 'medium',
      title: 'Medium',
      lineStart: 11,
    });

    const result = await majorityV1.aggregate(
      [review('a', [low]), review('b', [critical]), review('c', [medium])],
      { strategy: 'majority-v1' },
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.representative).toBe(critical);
  });

  test('requireAgreement acts as an additional floor above the majority', async () => {
    const a = finding({ reviewer: 'a', lineStart: 10 });
    const b = finding({ reviewer: 'b', lineStart: 11 });

    const result = await majorityV1.aggregate(
      [review('a', [a]), review('b', [b])],
      { strategy: 'majority-v1', requireAgreement: 3 },
    );

    // 2 reviewers agree (majority met) but floor of 3 is not reached
    expect(result.groups).toEqual([]);
    expect(result.unique).toEqual([a, b]);
  });
});

describe('severity-aware-v1', () => {
  test('promotes a lone reviewer critical finding (threshold 1 for critical)', async () => {
    const lone = finding({
      reviewer: 'a',
      severity: 'critical',
      lineStart: 10,
    });

    const result = await severityAwareV1.aggregate(
      [review('a', [lone]), review('b', [])],
      { strategy: 'severity-aware-v1' },
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.reviewers).toEqual(['a']);
    expect(result.unique).toEqual([]);
    expect(result.strategyId).toBe('severity-aware-v1');
  });

  test('drops a lone low-severity finding into unique (threshold 3 for low)', async () => {
    const lone = finding({ reviewer: 'a', severity: 'low', lineStart: 10 });

    const result = await severityAwareV1.aggregate(
      [review('a', [lone]), review('b', []), review('c', [])],
      { strategy: 'severity-aware-v1' },
    );

    expect(result.groups).toEqual([]);
    expect(result.unique).toEqual([lone]);
  });

  test('a medium-severity group needs two reviewers', async () => {
    const lone = finding({ reviewer: 'a', severity: 'medium', lineStart: 10 });
    const single = await severityAwareV1.aggregate(
      [review('a', [lone]), review('b', [])],
      { strategy: 'severity-aware-v1' },
    );
    expect(single.groups).toEqual([]);
    expect(single.unique).toEqual([lone]);

    const a = finding({ reviewer: 'a', severity: 'medium', lineStart: 10 });
    const b = finding({ reviewer: 'b', severity: 'medium', lineStart: 11 });
    const paired = await severityAwareV1.aggregate(
      [review('a', [a]), review('b', [b])],
      { strategy: 'severity-aware-v1' },
    );
    expect(paired.groups).toHaveLength(1);
    expect(paired.groups[0]?.reviewers).toEqual(['a', 'b']);
  });

  test('uses the highest severity in the group to pick the threshold', async () => {
    // A lone reviewer flags it as low, but another flags the same spot critical:
    // representative is critical -> threshold 1 -> promoted.
    const low = finding({ reviewer: 'a', severity: 'low', lineStart: 10 });
    const critical = finding({
      reviewer: 'b',
      severity: 'critical',
      lineStart: 11,
    });

    const result = await severityAwareV1.aggregate(
      [review('a', [low]), review('b', [critical])],
      { strategy: 'severity-aware-v1' },
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.representative).toBe(critical);
  });

  test('requireAgreement raises the floor even for critical findings', async () => {
    const lone = finding({
      reviewer: 'a',
      severity: 'critical',
      lineStart: 10,
    });

    const result = await severityAwareV1.aggregate(
      [review('a', [lone]), review('b', [])],
      { strategy: 'severity-aware-v1', requireAgreement: 2 },
    );

    expect(result.groups).toEqual([]);
    expect(result.unique).toEqual([lone]);
  });

  test('severityThresholds overrides the per-severity default', async () => {
    const lone = finding({
      reviewer: 'a',
      severity: 'critical',
      lineStart: 10,
    });

    const result = await severityAwareV1.aggregate(
      [review('a', [lone]), review('b', [])],
      { strategy: 'severity-aware-v1', severityThresholds: { critical: 2 } },
    );

    expect(result.groups).toEqual([]);
    expect(result.unique).toEqual([lone]);
  });
});

describe('similarity', () => {
  test('identical texts produce jaccard of 1', () => {
    const a = finding({
      reviewer: 'a',
      title: 'Hardcoded API key in login handler',
      body: 'The login handler exposes a hardcoded API key.',
    });
    const b = finding({
      reviewer: 'b',
      title: 'Hardcoded API key in login handler',
      body: 'The login handler exposes a hardcoded API key.',
    });
    expect(findingSimilarity(a, b)).toBe(1);
  });

  test('semantically similar titles produce high similarity', () => {
    const a = finding({
      reviewer: 'a',
      title: 'Hardcoded API key in login handler',
    });
    const b = finding({
      reviewer: 'b',
      title: 'Hardcoded API key exposed in login handler',
    });
    expect(findingSimilarity(a, b)).toBeGreaterThan(0.5);
  });

  test('unrelated findings produce low similarity', () => {
    const a = finding({
      reviewer: 'a',
      title: 'Hardcoded API key in login handler',
      body: 'Secret exposure',
    });
    const b = finding({
      reviewer: 'b',
      title: 'Missing index on users table',
      body: 'Performance concern',
    });
    expect(findingSimilarity(a, b)).toBeLessThan(0.3);
  });

  test('empty texts produce similarity 0', () => {
    const a = finding({ reviewer: 'a', title: '', body: '' });
    const b = finding({ reviewer: 'b', title: '', body: '' });
    expect(findingSimilarity(a, b)).toBe(0);
  });

  test('textToBigrams normalises and returns word bigrams', () => {
    const bigrams = textToBigrams('Hello, World! This is a Test.');
    expect(bigrams).toContain('hello world');
    expect(bigrams).toContain('is a');
    expect(bigrams).toContain('a test');
  });
});

describe('buildSemanticGroups', () => {
  test('groups cross-file findings with similar titles', () => {
    const auth = finding({
      reviewer: 'a',
      file: 'src/auth.ts',
      title: 'Hardcoded API key in login handler',
      body: 'Secret exposed',
    });
    const payments = finding({
      reviewer: 'b',
      file: 'src/payments.ts',
      title: 'Hardcoded API key in payment handler',
      body: 'Secret exposed',
    });

    const groups = buildSemanticGroups(
      [review('a', [auth]), review('b', [payments])],
      { similarityThreshold: 0.4 },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(2);
    expect(groups[0]?.reviewers.sort()).toEqual(['a', 'b']);
  });

  test('keeps unrelated findings in separate groups', () => {
    const auth = finding({
      reviewer: 'a',
      file: 'src/auth.ts',
      title: 'Hardcoded API key',
    });
    const perf = finding({
      reviewer: 'b',
      file: 'src/perf.ts',
      title: 'Missing index on users table',
      body: 'Slow query',
    });

    const groups = buildSemanticGroups(
      [review('a', [auth]), review('b', [perf])],
      { similarityThreshold: 0.4 },
    );

    expect(groups).toHaveLength(2);
  });

  test('merges structurally similar groups with semantic match', () => {
    const authA = finding({
      reviewer: 'a',
      file: 'src/auth.ts',
      lineStart: 10,
      title: 'Hardcoded API key',
    });
    const authB = finding({
      reviewer: 'b',
      file: 'src/auth.ts',
      lineStart: 11,
      title: 'Hardcoded API key exposed in auth',
    });
    const paymentsC = finding({
      reviewer: 'c',
      file: 'src/payments.ts',
      lineStart: 50,
      title: 'Hardcoded API key in payment handler',
    });

    const groups = buildSemanticGroups(
      [review('a', [authA]), review('b', [authB]), review('c', [paymentsC])],
      { similarityThreshold: 0.3 },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.reviewers.sort()).toEqual(['a', 'b', 'c']);
  });

  test('single group unchanged', () => {
    const a = finding({ reviewer: 'a', title: 'Single issue' });
    const groups = buildSemanticGroups([review('a', [a])]);
    expect(groups).toHaveLength(1);
  });
});

describe('detectContradictions', () => {
  test('detects significant severity gap as contradiction', () => {
    const low = finding({
      reviewer: 'a',
      severity: 'low',
      file: 'src/x.ts',
      title: 'Low issue',
    });
    const critical = finding({
      reviewer: 'b',
      severity: 'critical',
      file: 'src/x.ts',
      title: 'Critical issue',
    });

    const groups = buildSemanticGroups([
      review('a', [low]),
      review('b', [critical]),
    ]);
    const contradictions = detectContradictions(groups);

    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]?.reviewerA).toBe('a');
    expect(contradictions[0]?.reviewerB).toBe('b');
    expect(contradictions[0]?.note).toInclude('severity disagreement');
  });

  test('detects different categories on overlapping lines as contradiction', () => {
    const sec = finding({
      reviewer: 'a',
      category: 'security',
      file: 'src/x.ts',
      lineStart: 10,
      title: 'Input validation gap',
    });
    const style = finding({
      reviewer: 'b',
      category: 'style',
      file: 'src/x.ts',
      lineStart: 10,
      title: 'Input validation gap',
    });

    const groups = buildSemanticGroups(
      [review('a', [sec]), review('b', [style])],
      { similarityThreshold: 0.5 },
    );
    const contradictions = detectContradictions(groups);

    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]?.note).toInclude('security');
    expect(contradictions[0]?.note).toInclude('style');
  });

  test('no contradictions when findings agree on severity and category', () => {
    const a = finding({
      reviewer: 'a',
      severity: 'medium',
      category: 'correctness',
      file: 'src/x.ts',
      lineStart: 10,
    });
    const b = finding({
      reviewer: 'b',
      severity: 'medium',
      category: 'correctness',
      file: 'src/x.ts',
      lineStart: 11,
    });

    const groups = buildSemanticGroups([review('a', [a]), review('b', [b])]);
    const contradictions = detectContradictions(groups);

    expect(contradictions).toHaveLength(0);
  });

  test('no contradictions for single-member groups', () => {
    const a = finding({ reviewer: 'a', file: 'src/x.ts', title: 'Solo' });
    const groups = buildSemanticGroups([review('a', [a])]);
    const contradictions = detectContradictions(groups);
    expect(contradictions).toHaveLength(0);
  });

  test('different files on different categories are not contradictions', () => {
    const sec = finding({
      reviewer: 'a',
      category: 'security',
      file: 'src/a.ts',
      lineStart: 10,
      title: 'A',
    });
    const style = finding({
      reviewer: 'b',
      category: 'style',
      file: 'src/b.ts',
      lineStart: 10,
      title: 'B',
    });

    const groups = buildSemanticGroups([
      review('a', [sec]),
      review('b', [style]),
    ]);
    const contradictions = detectContradictions(groups);

    expect(contradictions).toHaveLength(0);
  });
});

describe('semantic-v2', () => {
  test('groups semantically similar findings across files', async () => {
    const authA = finding({
      reviewer: 'a',
      file: 'src/auth.ts',
      lineStart: 10,
      title: 'Hardcoded API key',
      body: 'Secret exposed',
    });
    const authB = finding({
      reviewer: 'b',
      file: 'src/auth.ts',
      lineStart: 11,
      title: 'Hardcoded API key in auth',
      body: 'Secret exposed',
    });
    const payments = finding({
      reviewer: 'c',
      file: 'src/payments.ts',
      lineStart: 50,
      title: 'Hardcoded API key in payments',
      body: 'Secret exposed',
    });

    const result = await semanticV2.aggregate(
      [review('a', [authA]), review('b', [authB]), review('c', [payments])],
      { strategy: 'semantic-v2', similarityThreshold: 0.4 },
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.reviewers.sort()).toEqual(['a', 'b', 'c']);
    expect(result.strategyId).toBe('semantic-v2');
  });

  test('respects requireAgreement threshold', async () => {
    const a = finding({ reviewer: 'a', file: 'src/a.ts', title: 'Issue one' });
    const b = finding({ reviewer: 'b', file: 'src/b.ts', title: 'Issue two' });

    const result = await semanticV2.aggregate(
      [review('a', [a]), review('b', [b])],
      { strategy: 'semantic-v2', requireAgreement: 2 },
    );

    expect(result.groups).toEqual([]);
    expect(result.unique).toHaveLength(2);
  });

  test('detects contradictions when enabled', async () => {
    const low = finding({
      reviewer: 'a',
      severity: 'low',
      file: 'src/x.ts',
      title: 'Low concern',
    });
    const critical = finding({
      reviewer: 'b',
      severity: 'critical',
      file: 'src/x.ts',
      title: 'Critical concern',
      lineStart: 9,
    });

    const result = await semanticV2.aggregate(
      [review('a', [low]), review('b', [critical])],
      { strategy: 'semantic-v2', enableContradictions: true },
    );

    expect(result.contradictions.length).toBeGreaterThan(0);
  });

  test('no contradictions when not enabled', async () => {
    const low = finding({
      reviewer: 'a',
      severity: 'low',
      file: 'src/x.ts',
      title: 'Low concern',
    });
    const critical = finding({
      reviewer: 'b',
      severity: 'critical',
      file: 'src/x.ts',
      title: 'Critical concern',
      lineStart: 9,
    });

    const result = await semanticV2.aggregate(
      [review('a', [low]), review('b', [critical])],
      { strategy: 'semantic-v2', enableContradictions: false },
    );

    expect(result.contradictions).toEqual([]);
  });

  test('resolves contradictions with meta-reviewer when provided', async () => {
    const low = finding({
      reviewer: 'a',
      severity: 'low',
      file: 'src/x.ts',
      title: 'Low concern',
    });
    const critical = finding({
      reviewer: 'b',
      severity: 'critical',
      file: 'src/x.ts',
      title: 'Critical concern',
      lineStart: 9,
    });

    const metaReview = async (_prompt: string): Promise<string> =>
      JSON.stringify({
        resolution: 'both_partial',
        explanation:
          'Both reviewers have valid points about different aspects.',
      });

    const result = await semanticV2.aggregate(
      [review('a', [low]), review('b', [critical])],
      { strategy: 'semantic-v2', enableContradictions: true },
      { metaReview },
    );

    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0]?.note).toInclude(
      'Meta-review: both_partial',
    );
    expect(result.contradictions[0]?.note).toInclude(
      'Both reviewers have valid points',
    );
  });
});

function review(reviewerId: string, findings: Finding[]): ReviewResult {
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
  lineEnd?: number;
  severity?: Severity;
  category?: Category;
  title?: string;
  body?: string;
}): Finding {
  const start = opts.lineStart ?? 10;
  return {
    file: opts.file ?? 'src/app.ts',
    lineRange: { start, end: opts.lineEnd ?? start },
    severity: opts.severity ?? 'medium',
    category: opts.category ?? 'correctness',
    title: opts.title ?? 'Shared issue',
    body: opts.body ?? 'Issue body',
    reviewer: opts.reviewer,
  };
}
