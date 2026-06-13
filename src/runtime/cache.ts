import crypto from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { PipelineResult } from '../core/pipeline.ts';

const CACHE_DIR = '.quorum/cache';

export interface CacheOptions {
  root: string;
  enabled: boolean;
}

function cachePath(root: string, key: string): string {
  return resolve(root, CACHE_DIR, `${key}.json`);
}

function hashParts(...parts: string[]): string {
  return crypto
    .createHash('sha256')
    .update(parts.join('\0'), 'utf8')
    .digest('hex')
    .slice(0, 16);
}

export async function getCachedResult(
  instruction: string,
  pipelineId: string,
  reviewerIds: string[],
  opts: CacheOptions,
): Promise<PipelineResult | undefined> {
  if (!opts.enabled) return undefined;
  try {
    const key = hashParts(instruction, pipelineId, ...reviewerIds);
    const file = Bun.file(cachePath(opts.root, key));
    const exists = await file.exists();
    if (!exists) return undefined;
    const text = await file.text();
    return JSON.parse(text) as PipelineResult;
  } catch {
    return undefined;
  }
}

export async function setCachedResult(
  instruction: string,
  pipelineId: string,
  reviewerIds: string[],
  result: PipelineResult,
  opts: CacheOptions,
): Promise<void> {
  if (!opts.enabled) return;
  try {
    const key = hashParts(instruction, pipelineId, ...reviewerIds);
    const path = cachePath(opts.root, key);
    const safe = {
      ...result,
      errors: result.errors.map((e) => ({
        reviewerId: e.reviewerId,
        message: e.message,
      })),
    };
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, JSON.stringify(safe));
  } catch {
    /* cache write is best-effort */
  }
}
