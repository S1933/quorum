import { describe, expect, test } from 'bun:test';
import { getCachedResult, setCachedResult } from '../src/runtime/cache.ts';
import type { PipelineResult } from '../src/core/pipeline.ts';

const opts = { root: '/tmp/quorum-cache-test', enabled: true };
const disabledOpts = { root: '/tmp/quorum-cache-test', enabled: false };

const sampleResult: PipelineResult = {
  pipelineId: 'default',
  reviews: [],
  consensus: { groups: [], agreement: {}, unique: [], contradictions: [], strategyId: 'none' },
  durationMs: 100,
  errors: [],
};

describe('cache', () => {
  test('returns undefined on cache miss', async () => {
    const result = await getCachedResult('unique-instruction-1', opts);
    expect(result).toBeUndefined();
  });

  test('stores and retrieves a cached result', async () => {
    const instruction = 'test-instruction-for-cache';
    await setCachedResult(instruction, sampleResult, opts);
    const result = await getCachedResult(instruction, opts);
    expect(result).toBeDefined();
    expect(result?.pipelineId).toBe('default');
    expect(result?.durationMs).toBe(100);
  });

  test('returns undefined when caching is disabled', async () => {
    await setCachedResult('disabled-test', sampleResult, opts);
    const result = await getCachedResult('disabled-test', disabledOpts);
    expect(result).toBeUndefined();
  });

  test('returns different results for different instructions', async () => {
    const a = 'instruction-a';
    const b = 'instruction-b';
    const resA: PipelineResult = { ...sampleResult, pipelineId: 'pipeline-a' };
    const resB: PipelineResult = { ...sampleResult, pipelineId: 'pipeline-b' };
    await setCachedResult(a, resA, opts);
    await setCachedResult(b, resB, opts);
    expect((await getCachedResult(a, opts))?.pipelineId).toBe('pipeline-a');
    expect((await getCachedResult(b, opts))?.pipelineId).toBe('pipeline-b');
  });

  test('handles cache write errors gracefully', async () => {
    const badOpts = { root: '/nonexistent/deep/path', enabled: true };
    await expect(
      setCachedResult('test', sampleResult, badOpts),
    ).resolves.toBeUndefined();
  });
});
