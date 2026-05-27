import { afterAll, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { EventBus } from '../src/core/events.ts';
import type { ReviewTask } from '../src/core/task.ts';
import { createRuntime } from '../src/runtime/runtime.ts';
import { claudeCodeFactory } from '../src/providers/claude-code/index.ts';

const tmpRoots: string[] = [];

afterAll(async () => {
  await Promise.all(tmpRoots.map((root) => rm(root, { recursive: true, force: true })));
});

describe('claude-code provider', () => {
  test('streams stdout preview tokens while collecting review output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quorum-'));
    tmpRoots.push(root);
    const binary = join(root, 'claude');
    await Bun.write(binary, '#!/bin/sh\nprintf \'{"findings":\'\nsleep 0.01\nprintf \'[]}\'\n');
    await chmod(binary, 0o755);

    const provider = await claudeCodeFactory.create(
      'claude-local',
      {
        type: 'claude-code',
        model: 'sonnet',
        binary,
        extra_args: [],
        timeout_ms: 5_000,
      },
      { workspaceRoot: root, env: {} },
    );

    const events: unknown[] = [];
    const result = await provider.review!(task(root), {
      bus: captureBus(events),
      signal: new AbortController().signal,
      workspace: { root },
    });

    expect(result.findings).toEqual([]);
    expect(result.rawOutput).toBe('{"findings":[]}');
    expect(tokenText(events)).toBe('{"findings":[]}');
  });

  test('rejects unsafe claude extra args', async () => {
    const runtime = await createRuntime({
      config: {
        version: 1,
        providers: {
          'claude-local': {
            type: 'claude-code',
            model: 'sonnet',
            extra_args: ['--dangerously-skip-permissions'],
          },
        },
        personas: {
          security: { description: 'Security', system: 'Review security.' },
        },
        reviewers: {
          sec: { persona: 'security', provider: 'claude-local' },
        },
        pipelines: {
          default: { parallel: true, reviewers: ['sec'] },
        },
      },
      pluginCtx: { workspaceRoot: '.', env: {} },
    });

    await expect(runtime.resolveProvider('claude-local')).rejects.toThrow('extra_args.0');
  });

  test('classifies timeouts distinctly from exit-code failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quorum-'));
    tmpRoots.push(root);
    const binary = join(root, 'claude');
    await Bun.write(binary, '#!/bin/sh\nsleep 3\nexit 0\n');
    await chmod(binary, 0o755);

    const provider = await claudeCodeFactory.create(
      'claude-local',
      {
        type: 'claude-code',
        model: 'sonnet',
        binary,
        extra_args: [],
        timeout_ms: 100,
      },
      { workspaceRoot: root, env: {} },
    );

    await expect(
      provider.review!(task(root), {
        bus: { emit() {}, on() { return () => {}; }, onAny() { return () => {}; } },
        signal: new AbortController().signal,
        workspace: { root },
      }),
    ).rejects.toThrow(/timed out/);
  });
});

function task(root: string): ReviewTask {
  return {
    kind: 'review',
    id: 'task-1',
    reviewerId: 'security-claude',
    systemPrompt: 'Review security issues.',
    instruction: 'Review this diff.',
    workspace: { root },
  };
}

function captureBus(events: unknown[]): EventBus {
  return {
    emit(e) {
      events.push(e);
    },
    on() {
      return () => {};
    },
    onAny() {
      return () => {};
    },
  };
}

function tokenText(events: unknown[]): string {
  return events
    .map((event) => event as { event?: { type?: string; text?: string } })
    .filter((event) => event.event?.type === 'token')
    .map((event) => event.event?.text ?? '')
    .join('');
}
