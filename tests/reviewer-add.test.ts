import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';
import { main, type CliDeps } from '../src/cli/index.ts';
import { loadConfigFromString } from '../src/config/loader.ts';

describe('reviewer add', () => {
  test('requires model', async () => {
    const { configPath, deps } = await repoDeps();
    const io = captureIo();

    const code = await main(
      ['reviewer', 'add', '--provider', 'claude-code', '--persona', 'security', '--config', configPath],
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
      ['reviewer', 'add', '--provider', 'claude-code', '--persona', 'security', '--model=', '--config', configPath],
      deps,
      io,
    );

    expect(code).toBe(1);
    expect(io.stderrText()).toContain('Missing --model flag');
  });

  test('adds reviewer with required model override and provider model', async () => {
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
        'claude-sonnet-4-20250514',
        '--config',
        configPath,
      ],
      deps,
      io,
    );

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('added provider "claude-code"');
    expect(io.stdoutText()).toContain('added reviewer "security-claude-code"');

    const updated = parseYaml(await Bun.file(configPath).text());
    expect(updated.providers['claude-code']).toEqual({
      type: 'claude-code',
      model: 'claude-sonnet-4-20250514',
    });
    expect(updated.reviewers['security-claude-code']).toEqual({
      persona: 'security',
      provider: 'claude-code',
      overrides: { model: 'claude-sonnet-4-20250514' },
    });
    expect(updated.pipelines.default.reviewers).toContain('security-claude-code');
  });
});

async function repoDeps(): Promise<{ configPath: string; deps: CliDeps }> {
  const root = await mkdtemp(join('/tmp', 'quorum-reviewer-add-'));
  const configPath = join(root, 'quorum.yaml');
  await Bun.write(configPath, configText);

  return {
    configPath,
    deps: {
      loadConfigFromPath: async (path) => loadConfigFromString(await Bun.file(path).text()),
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

const configText = `version: 1
defaults:
  pipeline: default
providers: {}
personas:
  security:
    description: Security reviewer
    system: Review security issues.
reviewers: {}
pipelines:
  default:
    parallel: true
    reviewers: []
`;

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    stdout: { write(chunk: unknown) { stdout += String(chunk); } },
    stderr: { write(chunk: unknown) { stderr += String(chunk); } },
    stdoutText() { return stdout; },
    stderrText() { return stderr; },
  };
}
