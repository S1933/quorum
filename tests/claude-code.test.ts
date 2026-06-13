import { afterAll, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeCodeFactory } from '../src/providers/claude-code/index.ts';
import { createRuntime } from '../src/runtime/runtime.ts';
import { captureBus, task, tokenText } from './helpers/subprocess.ts';

const tmpRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    tmpRoots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('claude-code provider', () => {
  test('streams stdout preview tokens while collecting review output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quorum-'));
    tmpRoots.push(root);
    const binary = join(root, 'claude');
    await Bun.write(
      binary,
      "#!/bin/sh\nprintf '{\"findings\":'\nsleep 0.01\nprintf '[]}'\n",
    );
    await chmod(binary, 0o755);

    const provider = await claudeCodeFactory.create(
      'claude-local',
      {
        type: 'claude-code',
        model: 'sonnet',
        binary,
        allow_project_binary: true,
        extra_args: [],
        timeout_ms: 5_000,
      },
      { workspaceRoot: root, env: {} },
    );

    const events: unknown[] = [];
    const result = (await provider.review?.(task(root, 'security-claude'), {
      bus: captureBus(events),
      signal: new AbortController().signal,
      workspace: { root },
    }))!;

    expect(result.findings).toEqual([]);
    expect(result.rawOutput).toBe('{"findings":[]}');
    expect(tokenText(events)).toBe('{"findings":[]}');
  });

  test('rejects unsafe claude extra args in inline provider config', async () => {
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
              type: 'claude-code',
              model: 'sonnet',
              extra_args: ['--dangerously-skip-permissions'],
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
      'extra_args.0',
    );
  });

  test('passes effort variant to claude code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quorum-'));
    tmpRoots.push(root);
    const binary = join(root, 'claude');
    const argsFile = join(root, 'args.txt');
    await Bun.write(
      binary,
      `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\nprintf '{"findings":[]}'\n`,
    );
    await chmod(binary, 0o755);

    const provider = await claudeCodeFactory.create(
      'claude-local',
      {
        type: 'claude-code',
        model: 'sonnet',
        variant: 'high',
        binary,
        allow_project_binary: true,
        extra_args: [],
        timeout_ms: 5_000,
      },
      { workspaceRoot: root, env: {} },
    );

    await provider.review?.(task(root, 'security-claude'), {
      bus: captureBus(),
      signal: new AbortController().signal,
      workspace: { root },
    });

    const args = await Bun.file(argsFile).text();
    expect(args).toContain('--model\nsonnet');
    expect(args).toContain('--effort\nhigh');
  });

  test('resolves reviewers with inline provider config', async () => {
    const runtime = await createRuntime({
      config: {
        version: 1,
        personas: {
          security: { description: 'Security', system: 'Review security.' },
        },
        reviewers: {
          sec: {
            persona: 'security',
            provider: { type: 'claude-code', model: 'sonnet' },
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
        allow_project_binary: true,
        extra_args: [],
        timeout_ms: 100,
      },
      { workspaceRoot: root, env: {} },
    );

    await expect(
      provider.review?.(task(root, 'security-claude'), {
        bus: captureBus(),
        signal: new AbortController().signal,
        workspace: { root },
      }),
    ).rejects.toThrow(/timed out/);
  });
});
