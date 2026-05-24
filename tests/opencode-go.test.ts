import { afterAll, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { EventBus } from '../src/core/events.ts';
import type { ReviewTask } from '../src/core/task.ts';
import { openCodeGoFactory } from '../src/providers/opencode-go/index.ts';

const tmpRoots: string[] = [];

const bus: EventBus = {
  emit() {},
  on() {
    return () => {};
  },
  onAny() {
    return () => {};
  },
};

afterAll(async () => {
  await Promise.all(tmpRoots.map((root) => rm(root, { recursive: true, force: true })));
});

describe('opencode-go provider', () => {
  test('runs the prompt-style CLI and parses structured findings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quorum-opencode-'));
    tmpRoots.push(root);
    const binary = join(root, 'opencode');
    await Bun.write(binary, '#!/bin/sh\nprintf \'{"findings":[]}\'\n');
    await chmod(binary, 0o755);

    const provider = await openCodeGoFactory.create(
      'opencode-local',
      {
        type: 'opencode-go',
        binary,
        command_style: 'prompt',
        output_format: 'text',
        quiet: true,
        extra_args: [],
        timeout_ms: 5_000,
      },
      { workspaceRoot: root, env: {} },
    );

    const task: ReviewTask = {
      kind: 'review',
      id: 'task-1',
      reviewerId: 'security-open',
      systemPrompt: 'Review security issues.',
      instruction: 'Review this diff.',
      workspace: { root },
    };

    const result = await provider.review!(task, {
      bus,
      signal: new AbortController().signal,
      workspace: { root },
    });

    expect(result.findings).toEqual([]);
    expect(result.rawOutput).toBe('{"findings":[]}');
  });

  test('passes model overrides to the prompt-style CLI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quorum-opencode-'));
    tmpRoots.push(root);
    const binary = join(root, 'opencode');
    const argsFile = join(root, 'args.txt');
    await Bun.write(binary, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\nprintf '{"findings":[]}'\n`);
    await chmod(binary, 0o755);

    const provider = await openCodeGoFactory.create(
      'opencode-local',
      {
        type: 'opencode-go',
        binary,
        command_style: 'prompt',
        output_format: 'text',
        quiet: true,
        extra_args: [],
        timeout_ms: 5_000,
      },
      { workspaceRoot: root, env: {} },
    );

    const task: ReviewTask = {
      kind: 'review',
      id: 'task-1',
      reviewerId: 'security-open',
      systemPrompt: 'Review security issues.',
      instruction: 'Review this diff.',
      workspace: { root },
    };

    await provider.review!(task, {
      bus,
      signal: new AbortController().signal,
      workspace: { root },
      modelOverride: { model: 'anthropic/claude-sonnet-4' },
    });

    const args = await Bun.file(argsFile).text();
    expect(args).toContain('--model\nanthropic/claude-sonnet-4');
  });

  test('reports timeout errors distinctly from process failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quorum-opencode-'));
    tmpRoots.push(root);
    const binary = join(root, 'opencode');
    await Bun.write(binary, '#!/bin/sh\nsleep 1\nprintf \'{"findings":[]}\'\n');
    await chmod(binary, 0o755);

    const provider = await openCodeGoFactory.create(
      'opencode-local',
      {
        type: 'opencode-go',
        binary,
        command_style: 'prompt',
        output_format: 'text',
        quiet: true,
        extra_args: [],
        timeout_ms: 10,
      },
      { workspaceRoot: root, env: {} },
    );

    const task: ReviewTask = {
      kind: 'review',
      id: 'task-1',
      reviewerId: 'security-open',
      systemPrompt: 'Review security issues.',
      instruction: 'Review this diff.',
      workspace: { root },
    };

    await expect(provider.review!(task, {
      bus,
      signal: new AbortController().signal,
      workspace: { root },
    })).rejects.toThrow('opencode timed out after 10ms');
  });
});
