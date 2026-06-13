import { afterAll, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCodeFactory } from '../src/providers/opencode/index.ts';
import { createRuntime } from '../src/runtime/runtime.ts';
import { captureBus, task, tokenText } from './helpers/subprocess.ts';

const tmpRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    tmpRoots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('opencode provider', () => {
  test('declares single-review concurrency to avoid shared opencode state locks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quorum-opencode-'));
    tmpRoots.push(root);
    const binary = join(root, 'opencode');
    await Bun.write(binary, '#!/bin/sh\nprintf \'{"findings":[]}\'\n');
    await chmod(binary, 0o755);

    const provider = await openCodeFactory.create(
      'opencode-local',
      {
        type: 'opencode',
        binary,
        allow_project_binary: true,
        command_style: 'prompt',
        output_format: 'text',
        quiet: true,
        extra_args: [],
        timeout_ms: 5_000,
      },
      { workspaceRoot: root, env: {} },
    );

    expect(provider.capabilities().maxConcurrentReviews).toBe(1);
  });

  test('runs the prompt-style CLI and parses structured findings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quorum-opencode-'));
    tmpRoots.push(root);
    const binary = join(root, 'opencode');
    await Bun.write(
      binary,
      "#!/bin/sh\nprintf '{\"findings\":'\nsleep 0.01\nprintf '[]}'\n",
    );
    await chmod(binary, 0o755);
    const events: unknown[] = [];
    const bus = captureBus(events);

    const provider = await openCodeFactory.create(
      'opencode-local',
      {
        type: 'opencode',
        binary,
        allow_project_binary: true,
        command_style: 'prompt',
        output_format: 'text',
        quiet: true,
        extra_args: [],
        timeout_ms: 5_000,
      },
      { workspaceRoot: root, env: {} },
    );

    const result = await provider.review?.(task(root, 'security-open'), {
      bus,
      signal: new AbortController().signal,
      workspace: { root },
    });

    expect(result.findings).toEqual([]);
    expect(result.rawOutput).toBe('{"findings":[]}');
    expect(tokenText(events)).toBe('{"findings":[]}');
  });

  test('passes model overrides and variant to opencode run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quorum-opencode-'));
    tmpRoots.push(root);
    const binary = join(root, 'opencode');
    const argsFile = join(root, 'args.txt');
    const stdinFile = join(root, 'stdin.txt');
    await Bun.write(
      binary,
      `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\ncat > '${stdinFile}'\nprintf '{"findings":[]}'\n`,
    );
    await chmod(binary, 0o755);

    const provider = await openCodeFactory.create(
      'opencode-local',
      {
        type: 'opencode',
        binary,
        allow_project_binary: true,
        command_style: 'run',
        output_format: 'json',
        quiet: true,
        variant: 'high',
        extra_args: [],
        timeout_ms: 5_000,
      },
      { workspaceRoot: root, env: {} },
    );

    const reviewTask = task(root, 'security-open');
    reviewTask.instruction =
      'Review this diff.\n--dangerous\n$(touch /tmp/should-not-run)';

    await provider.review?.(reviewTask, {
      bus: captureBus(),
      signal: new AbortController().signal,
      workspace: { root },
      modelOverride: { model: 'anthropic/claude-sonnet-4' },
    });

    const args = await Bun.file(argsFile).text();
    const stdin = await Bun.file(stdinFile).text();
    expect(args).toContain('run\n');
    expect(args).toContain('--model\nanthropic/claude-sonnet-4');
    expect(args).toContain('--variant\nhigh');
    expect(args).toContain('--format\njson');
    expect(args).not.toContain(reviewTask.instruction);
    expect(stdin).toContain(reviewTask.instruction);
  });

  test('reports timeout errors distinctly from process failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quorum-opencode-'));
    tmpRoots.push(root);
    const binary = join(root, 'opencode');
    await Bun.write(binary, '#!/bin/sh\nsleep 1\nprintf \'{"findings":[]}\'\n');
    await chmod(binary, 0o755);

    const provider = await openCodeFactory.create(
      'opencode-local',
      {
        type: 'opencode',
        binary,
        allow_project_binary: true,
        command_style: 'prompt',
        output_format: 'text',
        quiet: true,
        extra_args: [],
        timeout_ms: 10,
      },
      { workspaceRoot: root, env: {} },
    );

    await expect(
      provider.review?.(task(root, 'security-open'), {
        bus: captureBus(),
        signal: new AbortController().signal,
        workspace: { root },
      }),
    ).rejects.toThrow('opencode timed out after 10ms');
  });

  test('rejects unsafe opencode extra args', async () => {
    const runtime = await createRuntime({
      config: {
        version: 1,
        personas: {
          security: { description: 'Security', system: 'Review security.' },
        },
        reviewers: {
          sec: {
            persona: 'security',
            provider: { type: 'opencode', extra_args: ['--trust-all'] },
          },
        },
        pipelines: {
          default: { parallel: true, reviewers: ['sec'] },
        },
      },
      pluginCtx: { workspaceRoot: '.', env: {} },
    });

    await expect(runtime.resolveReviewer('sec')).rejects.toThrow(
      'extra_args.0',
    );
  });

  test('rejects variant with prompt-style opencode', async () => {
    const runtime = await createRuntime({
      config: {
        version: 1,
        personas: {
          security: { description: 'Security', system: 'Review security.' },
        },
        reviewers: {
          sec: {
            persona: 'security',
            provider: {
              type: 'opencode',
              command_style: 'prompt',
              variant: 'high',
            },
          },
        },
        pipelines: {
          default: { parallel: true, reviewers: ['sec'] },
        },
      },
      pluginCtx: { workspaceRoot: '.', env: {} },
    });

    await expect(runtime.resolveReviewer('sec')).rejects.toThrow(
      'variant is only supported when command_style is run',
    );
  });

  test('keeps opencode-go as a legacy provider alias', async () => {
    const runtime = await createRuntime({
      config: {
        version: 1,
        personas: {
          security: { description: 'Security', system: 'Review security.' },
        },
        reviewers: {
          sec: {
            persona: 'security',
            provider: {
              type: 'opencode-go',
              model: 'opencode-go/deepseek-v4-pro',
            },
          },
        },
        pipelines: {
          default: { parallel: true, reviewers: ['sec'] },
        },
      },
      pluginCtx: { workspaceRoot: '.', env: {} },
    });

    const reviewer = await runtime.resolveReviewer('sec');

    expect(reviewer.provider.id).toBe('sec:provider');
    expect(runtime.providers.list()).toContain('opencode');
    expect(runtime.providers.list()).toContain('opencode-go');
  });
});
