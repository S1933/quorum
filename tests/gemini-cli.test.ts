import { afterAll, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { geminiCliFactory } from '../src/providers/gemini-cli/index.ts';
import { createRuntime } from '../src/runtime/runtime.ts';
import { captureBus, task, tokenText } from './helpers/subprocess.ts';

const tmpRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    tmpRoots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('gemini-cli provider', () => {
  test('runs gemini in headless prompt mode and parses structured findings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quorum-gemini-'));
    tmpRoots.push(root);
    const binary = join(root, 'gemini');
    await Bun.write(
      binary,
      "#!/bin/sh\nprintf '{\"findings\":'\nsleep 0.01\nprintf '[]}\\n'\n",
    );
    await chmod(binary, 0o755);
    const events: unknown[] = [];

    const provider = await geminiCliFactory.create(
      'gemini-local',
      {
        type: 'gemini-cli',
        binary,
        allow_project_binary: true,
        model: 'gemini-2.5-pro',
        approval_mode: 'plan',
        sandbox: true,
        skip_trust: true,
        extra_args: [],
        timeout_ms: 5_000,
      },
      { workspaceRoot: root, env: {} },
    );

    const result = await provider.review?.(task(root, 'security-gemini'), {
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

    const reviewTask = task(root, 'security-gemini');
    reviewTask.instruction =
      'Review this diff.\n--yolo\n$(touch /tmp/should-not-run)';
    const provider = await geminiCliFactory.create(
      'gemini-local',
      {
        type: 'gemini-cli',
        binary,
        allow_project_binary: true,
        model: 'gemini-2.5-flash',
        approval_mode: 'plan',
        sandbox: true,
        skip_trust: true,
        extra_args: ['--screen-reader'],
        timeout_ms: 5_000,
      },
      { workspaceRoot: root, env: {} },
    );

    await provider.review?.(reviewTask, {
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
        personas: {
          security: { description: 'Security', system: 'Review security.' },
        },
        reviewers: {
          sec: { persona: 'security', provider: { type: 'gemini-cli' } },
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
          sec: {
            persona: 'security',
            provider: { type: 'gemini-cli', extra_args: ['--yolo'] },
          },
        },
        pipelines: {
          default: { parallel: true, reviewers: ['sec'] },
        },
      },
      pluginCtx: { workspaceRoot: '.', env: {} },
    });

    await expect(runtime.resolveReviewer('sec')).rejects.toThrow(
      'Invalid enum value',
    );
  });
});
