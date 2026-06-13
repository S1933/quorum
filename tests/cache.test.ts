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

const pipelineId = 'test';
const reviewerIds: string[] = [];

describe('cache', () => {
  test('returns undefined on cache miss', async () => {
    const result = await getCachedResult('unique-instruction-1', pipelineId, reviewerIds, opts);
    expect(result).toBeUndefined();
  });

  test('stores and retrieves a cached result', async () => {
    const instruction = 'test-instruction-for-cache';
    await setCachedResult(instruction, pipelineId, reviewerIds, sampleResult, opts);
    const result = await getCachedResult(instruction, pipelineId, reviewerIds, opts);
    expect(result).toBeDefined();
    expect(result?.pipelineId).toBe('default');
    expect(result?.durationMs).toBe(100);
  });

  test('returns undefined when caching is disabled', async () => {
    await setCachedResult('disabled-test', pipelineId, reviewerIds, sampleResult, opts);
    const result = await getCachedResult('disabled-test', pipelineId, reviewerIds, disabledOpts);
    expect(result).toBeUndefined();
  });

  test('differentiates by reviewer ids', async () => {
    const instruction = 'same-instruction';
    const resA: PipelineResult = { ...sampleResult, pipelineId: 'pipeline-a' };
    const resB: PipelineResult = { ...sampleResult, pipelineId: 'pipeline-b' };
    await setCachedResult(instruction, pipelineId, ['r1'], resA, opts);
    await setCachedResult(instruction, pipelineId, ['r2'], resB, opts);
    expect((await getCachedResult(instruction, pipelineId, ['r1'], opts))?.pipelineId).toBe('pipeline-a');
    expect((await getCachedResult(instruction, pipelineId, ['r2'], opts))?.pipelineId).toBe('pipeline-b');
  });

  test('differentiates by pipeline id', async () => {
    const instruction = 'same-instruction';
    const resA: PipelineResult = { ...sampleResult, pipelineId: 'pipeline-a' };
    const resB: PipelineResult = { ...sampleResult, pipelineId: 'pipeline-b' };
    await setCachedResult(instruction, 'pipe-a', ['r1'], resA, opts);
    await setCachedResult(instruction, 'pipe-b', ['r1'], resB, opts);
    expect((await getCachedResult(instruction, 'pipe-a', ['r1'], opts))?.pipelineId).toBe('pipeline-a');
    expect((await getCachedResult(instruction, 'pipe-b', ['r1'], opts))?.pipelineId).toBe('pipeline-b');
  });

  test('handles cache write errors gracefully', async () => {
    const badOpts = { root: '/nonexistent/deep/path', enabled: true };
    await expect(
      setCachedResult('test', pipelineId, reviewerIds, sampleResult, badOpts),
    ).resolves.toBeUndefined();
  });
});
