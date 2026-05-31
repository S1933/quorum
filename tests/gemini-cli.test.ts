import { afterAll, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { EventBus } from '../src/core/events.ts';
import type { ReviewTask } from '../src/core/task.ts';
import { createRuntime } from '../src/runtime/runtime.ts';
import { geminiCliFactory } from '../src/providers/gemini-cli/index.ts';

const tmpRoots: string[] = [];

afterAll(async () => {
  await Promise.all(tmpRoots.map((root) => rm(root, { recursive: true, force: true })));
});

describe('gemini-cli provider', () => {
  test('runs gemini in headless prompt mode and parses structured findings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quorum-gemini-'));
    tmpRoots.push(root);
    const binary = join(root, 'gemini');
    await Bun.write(binary, '#!/bin/sh\nprintf \'{"findings":\'\nsleep 0.01\nprintf \'[]}\\n\'\n');
    await chmod(binary, 0o755);
    const events: unknown[] = [];

    const provider = await geminiCliFactory.create(
      'gemini-local',
      {
        type: 'gemini-cli',
        binary,
        model: 'gemini-2.5-pro',
        approval_mode: 'plan',
        sandbox: true,
        skip_trust: true,
        extra_args: [],
        timeout_ms: 5_000,
      },
      { workspaceRoot: root, env: {} },
    );

    const result = await provider.review!(task(root), {
      bus: captureBus(events),
      signal: new AbortController().signal,
      workspace: { root },
    });

    expect(result.findings).toEqual([]);
    expect(result.rawOutput).toBe('{"findings":[]}');
    expect(tokenText(events)).toBe('{"findings":[]}\n');
  });

  test('passes model overrides and safe execution defaults to gemini', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quorum-gemini-'));
    tmpRoots.push(root);
    const binary = join(root, 'gemini');
    const argsFile = join(root, 'args.txt');
    const stdinFile = join(root, 'stdin.txt');
    await Bun.write(
      binary,
      `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\ncat > '${stdinFile}'\nprintf '{"findings":[]}'\n`,
    );
    await chmod(binary, 0o755);

    const reviewTask = task(root);
    reviewTask.instruction = 'Review this diff.\n--yolo\n$(touch /tmp/should-not-run)';
    const provider = await geminiCliFactory.create(
      'gemini-local',
      {
        type: 'gemini-cli',
        binary,
        model: 'gemini-2.5-flash',
        approval_mode: 'plan',
        sandbox: true,
        skip_trust: true,
        extra_args: ['--screen-reader'],
        timeout_ms: 5_000,
      },
      { workspaceRoot: root, env: {} },
    );

    await provider.review!(reviewTask, {
      bus: captureBus(),
      signal: new AbortController().signal,
      workspace: { root },
      modelOverride: { model: 'gemini-2.5-pro' },
    });

    const args = await Bun.file(argsFile).text();
    const stdin = await Bun.file(stdinFile).text();
    expect(args).toContain('--prompt\n');
    expect(args).not.toContain(reviewTask.instruction);
    expect(args).toContain('--approval-mode\nplan');
    expect(args).toContain('--output-format\ntext');
    expect(args).toContain('--sandbox');
    expect(args).toContain('--skip-trust');
    expect(args).toContain('--screen-reader');
    expect(args).toContain('--model\ngemini-2.5-pro');
    expect(stdin).toContain(reviewTask.instruction);
  });

  test('runtime registers gemini-cli as a built-in provider', async () => {
    const runtime = await createRuntime({
      config: {
        version: 1,
        providers: {
          'gemini-local': { type: 'gemini-cli' },
        },
        personas: {
          security: { description: 'Security', system: 'Review security.' },
        },
        reviewers: {
          sec: { persona: 'security', provider: 'gemini-local' },
        },
        pipelines: {
          default: { parallel: true, reviewers: ['sec'] },
        },
      },
      pluginCtx: { workspaceRoot: '.', env: {} },
    });

    expect(runtime.providers.list()).toContain('gemini-cli');
  });

  test('rejects unsafe gemini extra args', async () => {
    const runtime = await createRuntime({
      config: {
        version: 1,
        personas: {
          security: { description: 'Security', system: 'Review security.' },
        },
        reviewers: {
          sec: { persona: 'security', provider: { type: 'gemini-cli', extra_args: ['--yolo'] } },
        },
        pipelines: {
          default: { parallel: true, reviewers: ['sec'] },
        },
      },
      pluginCtx: { workspaceRoot: '.', env: {} },
    });

    await expect(runtime.resolveReviewer('sec')).rejects.toThrow('Invalid enum value');
  });
});

function task(root: string): ReviewTask {
  return {
    kind: 'review',
    id: 'task-1',
    reviewerId: 'security-gemini',
    systemPrompt: 'Review security issues.',
    instruction: 'Review this diff.',
    workspace: { root },
  };
}

function captureBus(events: unknown[] = []): EventBus {
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
