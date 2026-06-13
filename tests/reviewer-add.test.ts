import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { type CliDeps, main } from '../src/cli/index.ts';
import { loadConfigFromString } from '../src/config/loader.ts';

describe('reviewer add', () => {
  test('requires model', async () => {
    const { configPath, deps } = await repoDeps();
    const io = captureIo();

    const code = await main(
      [
        'reviewer',
        'add',
        '--provider',
        'claude-code',
        '--persona',
        'security',
        '--config',
        configPath,
      ],
      deps,
      io,
    );

    expect(code).toBe(1);
    expect(io.stderrText()).toContain('Missing --model flag');
  });

  test('rejects empty model', async () => {
    const { configPath, deps } = await repoDeps();
    const io = captureIo();

    const code = await main(
      [
        'reviewer',
        'add',
        '--provider',
        'claude-code',
        '--persona',
        'security',
        '--model=',
        '--config',
        configPath,
      ],
      deps,
      io,
    );

    expect(code).toBe(1);
    expect(io.stderrText()).toContain('Missing --model flag');
  });

  test('adds reviewer with inline provider model', async () => {
    const { configPath, deps } = await repoDeps();
    const io = captureIo();

    const code = await main(
      [
        'reviewer',
        'add',
        '--provider',
        'claude-code',
        '--persona',
        'security',
        '--model',
        'claude-opus-4-8',
        '--config',
        configPath,
      ],
      deps,
      io,
    );

    expect(code).toBe(0);
    const id = addedReviewerId(io);
    expect(id).toMatch(/^[a-z0-9]+-security-claude-code$/);

    const updated = parseYaml(await Bun.file(configPath).text());
    expect(updated.reviewers[id]).toEqual({
      persona: 'security',
      provider: {
        type: 'claude-code',
        model: 'claude-opus-4-8',
      },
    });
    expect(updated.pipelines.default.reviewers).toContain(id);
  });

  test('creates quorum.yaml from example when adding the first reviewer', async () => {
    const { root, configPath, deps } = await repoDepsWithoutConfig();
    const io = captureIo();

    expect(await Bun.file(configPath).exists()).toBe(false);

    const code = await main(
      [
        'reviewer',
        'add',
        '--provider',
        'openrouter',
        '--persona',
        'security',
        '--model',
        'anthropic/claude-sonnet-4',
      ],
      deps,
      io,
    );

    expect(code).toBe(0);
    expect(configPath).toBe(join(root, 'quorum.yaml'));
    expect(await Bun.file(configPath).exists()).toBe(true);
    expect(io.stdoutText()).toContain(
      `inited quorum config from example: ${configPath}`,
    );

    const id = addedReviewerId(io);
    const updated = parseYaml(await Bun.file(configPath).text());
    expect(updated.personas.security.description).toBe(
      'Adversarial security review',
    );
    expect(updated.reviewers[id]).toEqual({
      persona: 'security',
      provider: {
        type: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
      },
    });
    expect(updated.pipelines.default.reviewers).toContain(id);
  });

  test('adds reviewer with provider variant', async () => {
    const { configPath, deps } = await repoDeps();
    const io = captureIo();

    const code = await main(
      [
        'reviewer',
        'add',
        '--provider',
        'opencode',
        '--persona',
        'security',
        '--model',
        'opencode-go/deepseek-v4-pro',
        '--variant',
        'high',
        '--config',
        configPath,
      ],
      deps,
      io,
    );

    expect(code).toBe(0);
    const id = addedReviewerId(io);

    const updated = parseYaml(await Bun.file(configPath).text());
    expect(updated.reviewers[id]).toEqual({
      persona: 'security',
      provider: {
        type: 'opencode',
        model: 'opencode-go/deepseek-v4-pro',
        variant: 'high',
      },
    });
  });

  test('adds reviewer with temperature and fileExtensions', async () => {
    const { configPath, deps } = await repoDeps();
    const io = captureIo();

    const code = await main(
      [
        'reviewer',
        'add',
        '--provider',
        'openrouter',
        '--persona',
        'security',
        '--model',
        'anthropic/claude-sonnet-4',
        '--temperature',
        '0.2',
        '--fileExtensions',
        'ts,tsx',
        '--config',
        configPath,
      ],
      deps,
      io,
    );

    expect(code).toBe(0);
    const id = addedReviewerId(io);

    const updated = parseYaml(await Bun.file(configPath).text());
    expect(updated.reviewers[id]).toEqual({
      persona: 'security',
      provider: {
        type: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
      },
      fileExtensions: ['ts', 'tsx'],
      overrides: {
        temperature: 0.2,
      },
    });
    expect(updated.pipelines.default.reviewers).toContain(id);
  });

  test('rejects invalid temperature', async () => {
    const { configPath, deps } = await repoDeps();
    const io = captureIo();

    const code = await main(
      [
        'reviewer',
        'add',
        '--provider',
        'openrouter',
        '--persona',
        'security',
        '--model',
        'anthropic/claude-sonnet-4',
        '--temperature',
        'hot',
        '--config',
        configPath,
      ],
      deps,
      io,
    );

    expect(code).toBe(1);
    expect(io.stderrText()).toContain('Invalid --temperature flag');
  });

  test('normalizes legacy opencode-go provider flag to opencode', async () => {
    const { configPath, deps } = await repoDeps();
    const io = captureIo();

    const code = await main(
      [
        'reviewer',
        'add',
        '--provider',
        'opencode-go',
        '--persona',
        'security',
        '--model',
        'opencode-go/deepseek-v4-pro',
        '--config',
        configPath,
      ],
      deps,
      io,
    );

    expect(code).toBe(0);
    const id = addedReviewerId(io);
    expect(id).toMatch(/^[a-z0-9]+-security-opencode$/);

    const updated = parseYaml(await Bun.file(configPath).text());
    expect(updated.reviewers[id]).toEqual({
      persona: 'security',
      provider: {
        type: 'opencode',
        model: 'opencode-go/deepseek-v4-pro',
      },
    });
  });

  test('uses another name prefix when the first generated reviewer id has different config', async () => {
    const { configPath, deps } = await repoDeps();
    const firstIo = captureIo();

    const firstCode = await main(
      [
        'reviewer',
        'add',
        '--provider',
        'claude-code',
        '--persona',
        'security',
        '--model',
        'claude-opus-4-7',
        '--config',
        configPath,
      ],
      deps,
      firstIo,
    );
    const firstId = addedReviewerId(firstIo);
    const secondIo = captureIo();

    const secondCode = await main(
      [
        'reviewer',
        'add',
        '--provider',
        'claude-code',
        '--persona',
        'security',
        '--model',
        'claude-opus-4-8',
        '--config',
        configPath,
      ],
      deps,
      secondIo,
    );

    expect(firstCode).toBe(0);
    expect(secondCode).toBe(0);
    expect(secondIo.stdoutText()).not.toContain('already exists');
    const secondId = addedReviewerId(secondIo);
    expect(secondId).toMatch(/^[a-z0-9]+-security-claude-code$/);
    expect(secondId).not.toBe(firstId);
    expect(secondId.split('-')[0]).not.toBe(firstId.split('-')[0]);

    const updated = parseYaml(await Bun.file(configPath).text());
    expect(updated.reviewers[firstId]).toBeDefined();
    expect(updated.reviewers[secondId]).toEqual({
      persona: 'security',
      provider: {
        type: 'claude-code',
        model: 'claude-opus-4-8',
      },
    });
    expect(updated.pipelines.default.reviewers).toContain(secondId);
  });

  test('reuses a legacy reviewer id without a name prefix when config matches', async () => {
    const { configPath, deps } = await repoDeps(`reviewers:
  security-claude-code:
    persona: security
    provider:
      type: claude-code
      model: claude-opus-4-8
`);
    const io = captureIo();

    const code = await main(
      [
        'reviewer',
        'add',
        '--provider',
        'claude-code',
        '--persona',
        'security',
        '--model',
        'claude-opus-4-8',
        '--config',
        configPath,
      ],
      deps,
      io,
    );

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain(
      'Reviewer "security-claude-code" already exists',
    );

    const updated = parseYaml(await Bun.file(configPath).text());
    expect(Object.keys(updated.reviewers)).toEqual(['security-claude-code']);
  });

  test('reuses an existing reviewer id when persona provider and model already match', async () => {
    const { configPath, deps } = await repoDeps(`reviewers:
  alice-security-claude-code:
    persona: security
    provider:
      type: claude-code
      model: claude-opus-4-8
`);
    const io = captureIo();

    const code = await main(
      [
        'reviewer',
        'add',
        '--provider',
        'claude-code',
        '--persona',
        'security',
        '--model',
        'claude-opus-4-8',
        '--config',
        configPath,
      ],
      deps,
      io,
    );

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain(
      'Reviewer "alice-security-claude-code" already exists',
    );

    const updated = parseYaml(await Bun.file(configPath).text());
    expect(Object.keys(updated.reviewers)).toEqual([
      'alice-security-claude-code',
    ]);
  });
});

async function repoDeps(
  reviewers = 'reviewers: {}',
): Promise<{ configPath: string; deps: CliDeps }> {
  const root = await mkdtemp(join('/tmp', 'quorum-reviewer-add-'));
  const configPath = join(root, 'quorum.yaml');
  await Bun.write(configPath, configText(reviewers));

  return {
    configPath,
    deps: {
      loadConfigFromPath: async (path) =>
        loadConfigFromString(await Bun.file(path).text()),
      findConfigPath: () => configPath,
      inferRepoRoot: async () => root,
      probeWorkspace: async () => ({ root }),
      createRuntime: async () => ({}) as ReturnType<CliDeps['createRuntime']>,
      now: () => 1,
      initConfigIfMissing: async () => false,
      readConfigFile: async (path) => await Bun.file(path).text(),
      writeConfigFile: async (path, content) => {
        await Bun.write(path, content);
      },
    },
  };
}

async function repoDepsWithoutConfig(): Promise<{
  root: string;
  configPath: string;
  deps: CliDeps;
}> {
  const root = await mkdtemp(join('/tmp', 'quorum-reviewer-add-empty-'));
  const configPath = join(root, 'quorum.yaml');

  return {
    root,
    configPath,
    deps: {
      loadConfigFromPath: async (path) =>
        loadConfigFromString(await Bun.file(path).text()),
      findConfigPath: () => configPath,
      inferRepoRoot: async () => root,
      probeWorkspace: async () => ({ root }),
      createRuntime: async () => ({}) as ReturnType<CliDeps['createRuntime']>,
      now: () => 1,
      initConfigIfMissing: async (targetPath, examplePath) => {
        if (await Bun.file(targetPath).exists()) return false;
        await Bun.write(targetPath, await Bun.file(examplePath).text());
        return true;
      },
      readConfigFile: async (path) => await Bun.file(path).text(),
      writeConfigFile: async (path, content) => {
        await Bun.write(path, content);
      },
    },
  };
}

function configText(reviewers: string): string {
  return `version: 1
defaults:
  pipeline: default
personas:
  security:
    description: Security reviewer
    system: Review security issues.
${reviewers}
pipelines:
  default:
    parallel: true
    reviewers: []
`;
}

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    stdout: {
      write(chunk: unknown) {
        stdout += String(chunk);
      },
    },
    stderr: {
      write(chunk: unknown) {
        stderr += String(chunk);
      },
    },
    stdoutText() {
      return stdout;
    },
    stderrText() {
      return stderr;
    },
  };
}

function addedReviewerId(io: ReturnType<typeof captureIo>): string {
  const match = io.stdoutText().match(/added reviewer "([^"]+)"/);
  expect(match).not.toBeNull();
  return match?.[1]!;
}
