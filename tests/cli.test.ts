import { mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'bun:test';
import type { QuorumConfig } from '../src/config/schema.ts';
import type { Pipeline } from '../src/core/pipeline.ts';
import type { Provider } from '../src/core/provider.ts';
import type { ReviewResult } from '../src/core/task.ts';
import { overlapV1 } from '../src/consensus/overlap-v1.ts';
import { ConsensusRegistry } from '../src/consensus/registry.ts';
import { ProviderRegistry } from '../src/providers/registry.ts';
import type { BoundReviewer } from '../src/reviewers/reviewer.ts';
import { main, redactConfig, type CliDeps, type CliIo } from '../src/cli/index.ts';
import { loadConfigFromPath } from '../src/config/loader.ts';
import { createInitConfig } from '../src/config/init.ts';
import { InMemoryEventBus } from '../src/runtime/bus.ts';
import type { Runtime } from '../src/runtime/runtime.ts';

interface FakeRuntime extends Runtime {
  disposed: boolean;
  lastPipelineId: string | undefined;
  lastReviewerIds: string[] | undefined;
}

describe('cli', () => {
  test('config prints redacted configuration', async () => {
    const io = captureIo();

    const code = await main(
      ['config', '--config', '/repo/quorum.yaml'],
      deps({
        loadConfigFromPath: async (path) => {
          expect(path).toBe('/repo/quorum.yaml');
          return config();
        },
      }),
      io,
    );

    expect(code).toBe(0);
    const printed = JSON.parse(io.stdoutText()) as QuorumConfig;
    expect(printed.providers['fake-provider']?.api_key).toBe('***redacted***');
    expect(io.stderrText()).toBe('');
  });

  test('review runs configured pipeline through an injected runtime and writes report', async () => {
    const io = captureIo();
    const tmp = await mkdtemp(join(tmpdir(), 'quorum-cli-test-'));
    const reportPath = join(tmp, 'review.md');
    const runtime = fakeRuntime();

    const code = await main(
      ['review', '--config', '/repo/quorum.yaml', '--report', reportPath, '--no-color'],
      deps({
        loadConfigFromPath: async () => config(),
        inferRepoRoot: async () => '/repo',
        probeWorkspace: async () => ({
          root: '/repo',
          baseRef: 'main',
          diff: 'diff --git a/src/app.ts b/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1,2 @@\n+change',
          files: ['src/app.ts'],
        }),
        createRuntime: async () => runtime,
        now: () => 123,
      }),
      io,
    );

    expect(code).toBe(0);
    expect(runtime.disposed).toBe(true);
    expect(runtime.lastPipelineId).toBe('default');
    expect(runtime.lastReviewerIds).toEqual(['fake-reviewer']);
    expect(io.stdoutText()).toContain('pipeline default');
    expect(io.stdoutText()).toContain('[fake-reviewer] {"findings"');
    expect(io.stdoutText()).toContain('── Findings by priority ──');
    expect(io.stdoutText()).toContain('Priority: medium');
    expect(io.stdoutText()).toContain(`report: ${reportPath}`);

    const report = await Bun.file(reportPath).text();
    expect(report).toContain('# Quorum review — default');
    expect(report).toContain('## Findings by priority');
    expect(report).toContain('### Priority: medium');
    expect(report).toContain('Fake finding');
  });

  test('review prints machine-readable JSON without terminal progress output', async () => {
    const io = captureIo();
    const runtime = fakeRuntime();

    const code = await main(
      ['review', '--config', '/repo/quorum.yaml', '--json'],
      deps({
        loadConfigFromPath: async () => config(),
        inferRepoRoot: async () => '/repo',
        probeWorkspace: async () => ({
          root: '/repo',
          baseRef: 'main',
          diff: 'diff --git a/src/app.ts b/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1,2 @@\n+change',
          files: ['src/app.ts'],
        }),
        createRuntime: async () => runtime,
        now: () => 123,
      }),
      io,
    );

    expect(code).toBe(0);
    const printed = JSON.parse(io.stdoutText());
    expect(printed.schemaVersion).toBe(1);
    expect(printed.pipeline).toEqual({
      id: 'default',
      durationMs: expect.any(Number),
      reviewCount: 1,
      errorCount: 0,
    });
    expect(printed.reviews[0].reviewerId).toBe('fake-reviewer');
    expect(printed.reviews[0].findings[0].title).toBe('Fake finding');
    expect(printed.consensus.unique[0].file).toBe('src/app.ts');
    expect(printed.errors).toEqual([]);
    expect(io.stdoutText()).not.toContain('pipeline default');
    expect(io.stdoutText()).not.toContain('report:');
    expect(io.stderrText()).toBe('');
  });

  test('review writes JSON to report path when JSON output is selected', async () => {
    const io = captureIo();
    const tmp = await mkdtemp(join(tmpdir(), 'quorum-cli-json-test-'));
    const reportPath = join(tmp, 'review.json');

    const code = await main(
      ['review', '--config', '/repo/quorum.yaml', '--json', '--report', reportPath],
      deps({
        loadConfigFromPath: async () => config(),
        inferRepoRoot: async () => '/repo',
        probeWorkspace: async () => ({
          root: '/repo',
          baseRef: 'main',
          diff: 'diff --git a/src/app.ts b/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1,2 @@\n+change',
          files: ['src/app.ts'],
        }),
        createRuntime: async () => fakeRuntime(),
        now: () => 123,
      }),
      io,
    );

    expect(code).toBe(0);
    const stdoutJson = JSON.parse(io.stdoutText());
    const reportJson = JSON.parse(await Bun.file(reportPath).text());
    expect(reportJson).toEqual(stdoutJson);
    expect(reportJson.schemaVersion).toBe(1);
    expect(reportJson.reviews[0].findings[0].title).toBe('Fake finding');
  });

  test('init writes a default claude-code config', async () => {
    const io = captureIo();
    const tmp = await mkdtemp(join(tmpdir(), 'quorum-cli-init-test-'));
    const configPath = join(tmp, 'quorum.yaml');

    const code = await main(
      ['init', '--config', configPath],
      deps({ inferRepoRoot: async () => tmp }),
      io,
    );

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain(`Created ${configPath}`);
    const cfg = await loadConfigFromPath(configPath);
    expect(cfg.providers['claude-code-local']).toEqual({
      type: 'claude-code',
      model: 'claude-opus-4-7',
    });
    expect(Object.keys(cfg.personas)).toEqual([
      'security',
      'backend-senior',
      'architecture',
      'performance',
    ]);
    expect(cfg.pipelines.default?.reviewers).toEqual([
      'sec-reviewer',
      'backend-reviewer',
      'arch-reviewer',
      'perf-reviewer',
    ]);
    expect(cfg.personas.security?.system.trim()).toBe('Template security prompt.');
  });

  test('init supports provider, model, and persona selection', async () => {
    const io = captureIo();
    const tmp = await mkdtemp(join(tmpdir(), 'quorum-cli-init-test-'));
    const configPath = join(tmp, 'nested', 'quorum.yaml');

    const code = await main(
      [
        'init',
        '--config',
        configPath,
        '--provider',
        'opencode-go',
        '--model',
        'anthropic/claude-sonnet-4',
        '--personas',
        'security,performance',
      ],
      deps({ inferRepoRoot: async () => tmp }),
      io,
    );

    expect(code).toBe(0);
    const cfg = await loadConfigFromPath(configPath);
    expect(cfg.providers['opencode-local']).toEqual({
      type: 'opencode-go',
      model: 'anthropic/claude-sonnet-4',
      command_style: 'prompt',
    });
    expect(Object.keys(cfg.personas)).toEqual(['security', 'performance']);
    expect(Object.keys(cfg.reviewers)).toEqual(['sec-reviewer', 'perf-reviewer']);
    expect(cfg.pipelines.default?.reviewers).toEqual(['sec-reviewer', 'perf-reviewer']);
  });

  test('init supports multiple providers', async () => {
    const io = captureIo();
    const tmp = await mkdtemp(join(tmpdir(), 'quorum-cli-init-test-'));
    const configPath = join(tmp, 'quorum.yaml');

    const code = await main(
      [
        'init',
        '--config',
        configPath,
        '--provider',
        'claude-code,ollama',
        '--personas',
        'security,performance',
      ],
      deps({ inferRepoRoot: async () => tmp }),
      io,
    );

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('Providers: claude-code, ollama');
    const cfg = await loadConfigFromPath(configPath);
    expect(Object.keys(cfg.providers)).toEqual(['claude-code-local', 'ollama-local']);
    expect(cfg.providers['ollama-local']).toEqual({
      type: 'ollama',
      model: 'llama3.1',
      base_url: 'http://localhost:11434',
    });
    expect(Object.keys(cfg.reviewers)).toEqual([
      'sec-reviewer-claude-code',
      'sec-reviewer-ollama',
      'perf-reviewer-claude-code',
      'perf-reviewer-ollama',
    ]);
    expect(cfg.pipelines.default?.reviewers).toEqual([
      'sec-reviewer-claude-code',
      'sec-reviewer-ollama',
      'perf-reviewer-claude-code',
      'perf-reviewer-ollama',
    ]);
  });

  test('init rejects a single model override with multiple providers', async () => {
    const io = captureIo();
    const tmp = await mkdtemp(join(tmpdir(), 'quorum-cli-init-test-'));
    const configPath = join(tmp, 'quorum.yaml');

    const code = await main(
      [
        'init',
        '--config',
        configPath,
        '--provider',
        'claude-code,ollama',
        '--model',
        'custom-model',
      ],
      deps({ inferRepoRoot: async () => tmp }),
      io,
    );

    expect(code).toBe(1);
    expect(io.stderrText()).toContain('Cannot use --model with multiple providers');
    expect(await Bun.file(configPath).exists()).toBe(false);
  });

  test('init prompts interactively for providers, personas, and model', async () => {
    const io = captureIo();
    const tmp = await mkdtemp(join(tmpdir(), 'quorum-cli-init-test-'));
    const configPath = join(tmp, 'quorum.yaml');
    const selections = [['opencode-go'], ['security', 'performance']];

    const code = await main(
      ['init', '--config', configPath],
      deps({
        inferRepoRoot: async () => tmp,
        isInteractive: () => true,
        selectMany: async (question) => {
          io.stdout.write(`${question}\n`);
          return selections.shift() ?? [];
        },
        prompt: async () => 'anthropic/claude-sonnet-4',
      }),
      io,
    );

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('Select provider(s) to configure first');
    expect(io.stdoutText()).toContain('Select persona(s) to enable');
    expect(io.stdoutText()).toContain('Providers: opencode-go');
    expect(io.stdoutText()).toContain('Personas: security, performance');
    const cfg = await loadConfigFromPath(configPath);
    expect(cfg.providers['opencode-local']).toEqual({
      type: 'opencode-go',
      model: 'anthropic/claude-sonnet-4',
      command_style: 'prompt',
    });
    expect(Object.keys(cfg.personas)).toEqual(['security', 'performance']);
  });

  test('init interactive prompts accept all and default choices', async () => {
    const io = captureIo();
    const tmp = await mkdtemp(join(tmpdir(), 'quorum-cli-init-test-'));
    const configPath = join(tmp, 'quorum.yaml');
    const selections = [['claude-code'], ['security', 'backend-senior', 'architecture', 'performance']];

    const code = await main(
      ['init', '--config', configPath],
      deps({
        inferRepoRoot: async () => tmp,
        isInteractive: () => true,
        selectMany: async () => selections.shift() ?? [],
        prompt: async () => '',
      }),
      io,
    );

    expect(code).toBe(0);
    const cfg = await loadConfigFromPath(configPath);
    expect(Object.keys(cfg.providers)).toEqual(['claude-code-local']);
    expect(cfg.providers['claude-code-local']?.model).toBe('claude-opus-4-7');
    expect(Object.keys(cfg.personas)).toEqual([
      'security',
      'backend-senior',
      'architecture',
      'performance',
    ]);
  });

  test('init help prints usage without resolving the repository', async () => {
    const io = captureIo();

    const code = await main(
      ['init', '--help'],
      deps({
        inferRepoRoot: async () => {
          throw new Error('should not resolve repository');
        },
      }),
      io,
    );

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('quorum init — create a starter quorum.yaml');
    expect(io.stdoutText()).toContain('--list-providers');
    expect(io.stderrText()).toBe('');
  });

  test('init lists supported providers without writing a config', async () => {
    const io = captureIo();

    const code = await main(
      ['init', '--list-providers'],
      deps({
        inferRepoRoot: async () => {
          throw new Error('should not resolve repository');
        },
      }),
      io,
    );

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('claude-code\tdefault model: claude-opus-4-7');
    expect(io.stdoutText()).toContain('ollama\tdefault model: llama3.1');
    expect(io.stderrText()).toBe('');
  });

  test('init lists supported personas without writing a config', async () => {
    const io = captureIo();

    const code = await main(
      ['init', '--list-personas'],
      deps({
        inferRepoRoot: async () => {
          throw new Error('should not resolve repository');
        },
      }),
      io,
    );

    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('security\tAdversarial security review');
    expect(io.stdoutText()).toContain('performance\tPerformance and scalability review');
    expect(io.stderrText()).toBe('');
  });

  test('init refuses to overwrite an existing config without force', async () => {
    const io = captureIo();
    const tmp = await mkdtemp(join(tmpdir(), 'quorum-cli-init-test-'));
    const configPath = join(tmp, 'quorum.yaml');
    await mkdir(tmp, { recursive: true });
    await Bun.write(configPath, 'existing');

    const code = await main(
      ['init', '--config', configPath],
      deps({ inferRepoRoot: async () => tmp }),
      io,
    );

    expect(code).toBe(1);
    expect(await Bun.file(configPath).text()).toBe('existing');
    expect(io.stderrText()).toContain('Config file already exists');
  });

  test('init rejects config paths outside the repository', async () => {
    const io = captureIo();
    const root = await mkdtemp(join(tmpdir(), 'quorum-cli-init-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'quorum-cli-init-outside-'));
    const configPath = join(outside, 'quorum.yaml');

    const code = await main(
      ['init', '--config', configPath],
      deps({ inferRepoRoot: async () => root }),
      io,
    );

    expect(code).toBe(1);
    expect(io.stderrText()).toContain('Refusing to write config outside repository');
    expect(await Bun.file(configPath).exists()).toBe(false);
  });

  test('init safely serializes model values as YAML data', async () => {
    const io = captureIo();
    const tmp = await mkdtemp(join(tmpdir(), 'quorum-cli-init-test-'));
    const configPath = join(tmp, 'quorum.yaml');

    const code = await main(
      [
        'init',
        '--config',
        configPath,
        '--provider',
        'opencode-go',
        '--model',
        'safe-model\nreviewers:\n  injected: { persona: security, provider: opencode-local }',
        '--personas',
        'security',
      ],
      deps({ inferRepoRoot: async () => tmp }),
      io,
    );

    expect(code).toBe(0);
    const cfg = await loadConfigFromPath(configPath);
    expect(Object.keys(cfg.reviewers)).toEqual(['sec-reviewer']);
    expect(cfg.providers['opencode-local']?.model).toBe(
      'safe-model\nreviewers:\n  injected: { persona: security, provider: opencode-local }',
    );
  });
});

describe('redactConfig', () => {
  test('redacts lazy env refs', () => {
    const input = {
      api_key: { __lazyEnv: true, varName: 'OPENROUTER_API_KEY', resolve: () => 'sk-key' },
    };
    const result = redactConfig(input) as Record<string, unknown>;
    expect(result.api_key).toBe('***redacted***');
  });

  test('redacts schema-defined sensitive fields for known provider types', () => {
    const input = {
      type: 'openrouter',
      api_key: 'sk-123',
      model: 'gpt-4',
      base_url: 'https://openrouter.ai/api/v1',
    };
    const result = redactConfig(input) as Record<string, unknown>;
    expect(result.api_key).toBe('***redacted***');
    expect(result.model).toBe('gpt-4');
  });

  test('redacts schema-defined sensitive fields for cursor-agent provider', () => {
    const input = {
      type: 'cursor-agent',
      api_key: 'sk-cursor',
      model: 'claude-sonnet',
    };
    const result = redactConfig(input) as Record<string, unknown>;
    expect(result.api_key).toBe('***redacted***');
    expect(result.model).toBe('claude-sonnet');
  });

  test('redacts nested provider configs with schema-aware fields', () => {
    const input = {
      providers: {
        openrouter_main: { type: 'openrouter', api_key: 'sk-abc', model: 'gpt-4' },
        local_ai: { type: 'claude-code', model: 'claude-opus' },
      },
    };
    const result = redactConfig(input) as Record<string, unknown>;
    const providers = result.providers as Record<string, unknown>;
    expect((providers.openrouter_main as Record<string, unknown>).api_key).toBe('***redacted***');
    expect((providers.openrouter_main as Record<string, unknown>).model).toBe('gpt-4');
    expect((providers.local_ai as Record<string, unknown>).model).toBe('claude-opus');
  });

  test('redacts nonstandard-key values when schema marks them sensitive', () => {
    const input = {
      providers: {
        custom: { type: 'cursor-agent', auth_header: 'sk-test', api_key: 'sk-test-2' },
      },
    };
    const result = redactConfig(input) as Record<string, unknown>;
    const providers = result.providers as Record<string, unknown>;
    const custom = providers.custom as Record<string, unknown>;
    expect(custom.api_key).toBe('***redacted***');
    expect(custom.auth_header).toBe('sk-test');
  });

  test('falls back to key-name heuristics for unknown provider types', () => {
    const input = {
      type: 'unknown-provider',
      api_key: 'secret-123',
      password: 'pwd',
      access_token: 'tok',
      public_field: 'visible',
    };
    const result = redactConfig(input) as Record<string, unknown>;
    expect(result.api_key).toBe('***redacted***');
    expect(result.password).toBe('***redacted***');
    expect(result.access_token).toBe('***redacted***');
    expect(result.public_field).toBe('visible');
  });

  test('redacts secret fields nested arbitrarily deep', () => {
    const input = {
      providers: {
        nested: {
          level: {
            type: 'openrouter',
            api_key: 'deep-secret',
          },
        },
      },
    };
    const result = redactConfig(input) as Record<string, unknown>;
    const providers = result.providers as Record<string, unknown>;
    const nested = (providers.nested as Record<string, unknown>).level as Record<string, unknown>;
    expect(nested.api_key).toBe('***redacted***');
  });

  test('redacts env:VAR pattern values under sensitive keys', () => {
    const input = {
      type: 'openrouter',
      api_key: 'env:OPENROUTER_API_KEY',
    };
    const result = redactConfig(input) as Record<string, unknown>;
    expect(result.api_key).toBe('***redacted***');
  });

  test('redacts lazy env ref values under any key', () => {
    const lazyRef = { __lazyEnv: true, varName: 'MY_SECRET', resolve: () => 'value' };
    const input = {
      providers: {
        oc: { type: 'opencode-go', api_key: lazyRef },
      },
    };
    const result = redactConfig(input) as Record<string, unknown>;
    const providers = result.providers as Record<string, unknown>;
    expect((providers.oc as Record<string, unknown>).api_key).toBe('***redacted***');
  });
});

function config(): QuorumConfig {
  return {
    version: 1,
    defaults: { pipeline: 'default' },
    providers: {
      'fake-provider': {
        type: 'fake',
        api_key: 'secret-key',
      },
    },
    personas: {
      fake: {
        description: 'Fake persona',
        system: 'Review.',
      },
    },
    reviewers: {
      'fake-reviewer': {
        persona: 'fake',
        provider: 'fake-provider',
      },
    },
    pipelines: {
      default: {
        parallel: true,
        reviewers: ['fake-reviewer'],
      },
    },
  };
}

function deps(overrides: Partial<CliDeps>): CliDeps {
  return {
    loadConfigFromPath: async () => config(),
    findConfigPath: () => '/repo/quorum.yaml',
    createInitConfig: (opts) => createInitConfig({ ...opts, personaTemplates: personaTemplates() }),
    inferRepoRoot: async () => '/repo',
    probeWorkspace: async () => ({ root: '/repo' }),
    createRuntime: async () => fakeRuntime(),
    isInteractive: () => false,
    prompt: async () => '',
    selectMany: async (_question, _choices, defaults) => defaults,
    now: () => 1,
    ...overrides,
  };
}

function personaTemplates(): Record<string, { description: string; system: string }> {
  return {
    security: {
      description: 'Adversarial security review',
      system: 'Template security prompt.',
    },
    'backend-senior': {
      description: 'Senior backend engineering review',
      system: 'Template backend prompt.',
    },
    architecture: {
      description: 'Architecture and maintainability review',
      system: 'Template architecture prompt.',
    },
    performance: {
      description: 'Performance and scalability review',
      system: 'Template performance prompt.',
    },
  };
}

function fakeRuntime(): FakeRuntime {
  const consensus = new ConsensusRegistry();
  consensus.register(overlapV1);
  const runtime: FakeRuntime = {
    bus: new InMemoryEventBus(),
    providers: new ProviderRegistry(),
    consensus,
    config: config(),
    pluginCtx: { workspaceRoot: '/repo', env: {} },
    disposed: false,
    lastPipelineId: undefined,
    lastReviewerIds: undefined,
    async resolveProvider() {
      throw new Error('not used');
    },
    async resolveReviewer() {
      throw new Error('not used');
    },
    async resolveReviewers(ids: string[]) {
      runtime.lastReviewerIds = ids;
      return [reviewer('fake-reviewer')];
    },
    resolvePipeline(id: string): Pipeline {
      runtime.lastPipelineId = id;
      return { id, parallel: true, reviewers: ['fake-reviewer'] };
    },
    async dispose() {
      runtime.disposed = true;
    },
  };
  return runtime;
}

function reviewer(id: string): BoundReviewer {
  return {
    id,
    persona: { id: 'fake', description: 'Fake persona', system: 'Review.' },
    provider: fakeProvider(),
    async run(task, ctx): Promise<ReviewResult> {
      ctx.bus.emit({
        type: 'reviewer.event',
        reviewerId: id,
        event: { type: 'token', text: '{"findings":[{"title":"Fake finding"}]}' },
      });
      return {
        taskId: task.id,
        reviewerId: id,
        findings: [
          {
            file: 'src/app.ts',
            lineRange: { start: 1, end: 1 },
            severity: 'medium',
            category: 'correctness',
            title: 'Fake finding',
            body: 'Fake body',
            reviewer: id,
          },
        ],
        rawOutput: '{"findings":[]}',
        durationMs: 1,
      };
    },
  };
}

function fakeProvider(): Provider {
  return {
    id: 'fake-provider',
    kind: 'http',
    capabilities() {
      return {
        review: true,
        streaming: false,
        tools: false,
        mcp: false,
        localExecution: false,
        backgroundJobs: false,
        costReporting: false,
      };
    },
  };
}

function captureIo(): CliIo & {
  stdoutText(): string;
  stderrText(): string;
} {
  let stdout = '';
  let stderr = '';
  return {
    stdout: {
      write(chunk) {
        stdout += String(chunk);
      },
    },
    stderr: {
      write(chunk) {
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
