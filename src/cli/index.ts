#!/usr/bin/env bun
import { mkdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { loadConfigFromPath, findConfigPath } from '../config/loader.ts';
import type { QuorumConfig } from '../config/schema.ts';
import {
  createInitConfig,
  defaultInitModel,
  INIT_PROVIDERS,
  loadInitPersonaTemplates,
  type InitConfigOptions,
  type InitConfigResult,
} from '../config/init.ts';
import { createRuntime as createRuntimeDefault, type Runtime } from '../runtime/runtime.ts';
import { defaultPluginCtx } from '../runtime/plugin.ts';
import { probeWorkspace, inferRepoRoot } from '../runtime/workspace.ts';
import { PipelineExecutor } from '../pipelines/executor.ts';
import { TerminalRenderer } from '../ui/terminal.ts';
import { renderMarkdownReport } from '../ui/markdown.ts';
import { renderJsonReport } from '../ui/json.ts';
import { promptQuestion, selectManyCheckbox, type SelectChoice } from '../ui/select.ts';
import { QuorumError, ConfigError } from '../core/errors.ts';
import { isLazyEnvRef } from '../config/interpolate.ts';
import { getSensitiveFields } from '../config/sensitive-fields.ts';
import type { WorkspaceInfo } from '../core/task.ts';
import type { WriteStreamLike } from '../ui/terminal.ts';

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export interface CliIo {
  stdout: WriteStreamLike;
  stderr: WriteStreamLike;
}

export interface CliDeps {
  loadConfigFromPath(path: string): Promise<QuorumConfig>;
  findConfigPath(cwd?: string): string;
  createInitConfig(opts: InitConfigOptions): Promise<InitConfigResult>;
  inferRepoRoot(start?: string): Promise<string>;
  probeWorkspace(opts: { root: string; baseRef?: string }): Promise<WorkspaceInfo>;
  createRuntime(opts: Parameters<typeof createRuntimeDefault>[0]): Promise<Runtime>;
  isInteractive(): boolean;
  prompt(question: string, io: CliIo): Promise<string>;
  selectMany(
    question: string,
    choices: SelectChoice[],
    defaults: string[],
    io: CliIo,
  ): Promise<string[]>;
  now(): number;
}

const defaultIo: CliIo = {
  stdout: process.stdout,
  stderr: process.stderr,
};

const defaultDeps: CliDeps = {
  loadConfigFromPath,
  findConfigPath,
  createInitConfig,
  inferRepoRoot,
  probeWorkspace,
  createRuntime: createRuntimeDefault,
  isInteractive: () => process.stdin.isTTY === true,
  prompt: promptQuestion,
  selectMany: selectManyCheckbox,
  now: Date.now,
};

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = rest[i + 1];
        if (next && !next.startsWith('--')) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { command, positional, flags };
}

function printHelp(io: CliIo): void {
  io.stdout.write(`quorum — multi-model consensus reviewer

Usage:
  quorum review [pipeline-id] [--pipeline <id>] [--base <ref>] [--config <path>] [--report <path>] [--format text|json] [--json] [--no-color] [--no-preview]
  quorum config [--config <path>]
  quorum init [--config <path>] [--provider <type>] [--model <id>] [--personas <ids>] [--force] [--list-providers] [--list-personas]
  quorum help

Defaults are read from quorum.yaml in the working directory.
`);
}

function printInitHelp(io: CliIo): void {
  io.stdout.write(`quorum init — create a starter quorum.yaml

Usage:
  quorum init [--config <path>] [--provider <type>] [--model <id>] [--personas <ids>] [--force]
  quorum init --list-providers
  quorum init --list-personas

Options:
  --provider <type>   Provider to configure. Use comma-separated ids for multiple providers.
  --model <id>        Provider model or config id.
  --personas <ids>    Comma-separated persona ids.
  --force             Overwrite an existing config.

When run in a terminal without --provider or --personas, init shows checkbox selectors.
`);
}

export async function main(
  argv: string[] = process.argv.slice(2),
  deps: CliDeps = defaultDeps,
  io: CliIo = defaultIo,
): Promise<number> {
  const { command, positional, flags } = parseArgs(argv);

  try {
    switch (command) {
      case 'help':
      case '-h':
      case '--help':
        printHelp(io);
        return 0;
      case 'review':
        return await cmdReview(positional, flags, deps, io);
      case 'config':
        return await cmdConfig(flags, deps, io);
      case 'init':
        return await cmdInit(flags, deps, io);
      default:
        io.stderr.write(`Unknown command: ${command}\n\n`);
        printHelp(io);
        return 2;
    }
  } catch (err) {
    if (err instanceof QuorumError) {
      io.stderr.write(`error: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

async function cmdReview(
  positional: string[],
  flags: Record<string, string | boolean>,
  deps: CliDeps,
  io: CliIo,
): Promise<number> {
  if (positional.length > 1) {
    throw new ConfigError(`Unexpected review arguments: ${positional.slice(1).join(' ')}`);
  }
  const configPath = typeof flags.config === 'string' ? flags.config : deps.findConfigPath();
  const config = await deps.loadConfigFromPath(configPath);
  const format = reviewOutputFormat(flags);
  const pipelineId =
    (typeof flags.pipeline === 'string' && flags.pipeline) || positional[0] || config.defaults?.pipeline;
  if (!pipelineId) throw new ConfigError('No pipeline specified and no defaults.pipeline configured');

  const root = await deps.inferRepoRoot();
  const workspace = await deps.probeWorkspace({
    root,
    ...(typeof flags.base === 'string' ? { baseRef: flags.base } : {}),
  });

  if (!workspace.diff) {
    io.stderr.write('No diff detected against base ref — nothing to review.\n');
    return 0;
  }

  const pluginCtx = defaultPluginCtx(root);
  const runtime = await deps.createRuntime({ config, pluginCtx });

  const pipeline = runtime.resolvePipeline(pipelineId);
  const reviewers = await runtime.resolveReviewers(pipeline.reviewers);

  const detach =
    format === 'text'
      ? new TerminalRenderer({
          stream: io.stdout,
          color: flags['no-color'] !== true,
          showTokens: flags['no-preview'] !== true,
        }).attach(runtime.bus)
      : () => undefined;

  const executor = new PipelineExecutor();
  const instruction = buildReviewInstruction(workspace.diff, workspace.files ?? []);

  try {
    const result = await executor.run({
      pipeline,
      reviewers,
      workspace,
      instruction,
      taskId: `review-${deps.now()}`,
      bus: runtime.bus,
      consensus: runtime.consensus,
    });

    if (format === 'json') {
      const json = renderJsonReport(result);
      if (typeof flags.report === 'string') {
        await writeReport(flags.report, json);
      }
      io.stdout.write(json);
    } else {
      const reportPath = typeof flags.report === 'string' ? flags.report : `${root}/.quorum/last-review.md`;
      await writeReport(reportPath, renderMarkdownReport(result));
      io.stdout.write(`\nreport: ${reportPath}\n`);
    }
    return result.errors.length > 0 && result.reviews.length === 0 ? 1 : 0;
  } finally {
    detach();
    await runtime.dispose();
  }
}

async function cmdConfig(
  flags: Record<string, string | boolean>,
  deps: CliDeps,
  io: CliIo,
): Promise<number> {
  const configPath = typeof flags.config === 'string' ? flags.config : deps.findConfigPath();
  const config = await deps.loadConfigFromPath(configPath);
  const redacted = redactConfig(config);
  io.stdout.write(`${JSON.stringify(redacted, null, 2)}\n`);
  return 0;
}

async function cmdInit(
  flags: Record<string, string | boolean>,
  deps: CliDeps,
  io: CliIo,
): Promise<number> {
  if (flags.help === true || flags.h === true) {
    printInitHelp(io);
    return 0;
  }
  if (flags['list-providers'] === true) {
    for (const provider of INIT_PROVIDERS) {
      io.stdout.write(`${provider}\tdefault model: ${defaultInitModel(provider)}\n`);
    }
    return 0;
  }
  if (flags['list-personas'] === true) {
    const personas = await loadInitPersonaTemplates();
    for (const [id, persona] of Object.entries(personas)) {
      io.stdout.write(`${id}\t${persona.description}\n`);
    }
    return 0;
  }

  const providers = await promptInitProviders(flags, deps, io);
  const personas = await promptInitPersonas(flags, deps, io);
  const model = await promptInitModel(flags, providers, deps, io);
  const root = await deps.inferRepoRoot();
  const configPath = resolveConfigPath(root, flags.config, deps);
  assertPathInside(root, configPath);

  if (await Bun.file(configPath).exists()) {
    if (flags.force !== true) {
      throw new ConfigError(`Config file already exists: ${configPath}. Pass --force to overwrite.`);
    }
  }

  const initOpts: InitConfigOptions = {};
  if (providers) initOpts.providers = providers;
  if (providers === undefined && flags.provider !== undefined) initOpts.provider = flags.provider;
  if (model !== undefined) initOpts.model = model;
  if (model === undefined && typeof flags.model === 'string') initOpts.model = flags.model;
  if (personas !== undefined) initOpts.personas = personas.join(',');
  if (personas === undefined && flags.personas !== undefined) initOpts.personas = flags.personas;
  const result = await deps.createInitConfig(initOpts);

  await writeReport(configPath, result.yaml);
  io.stdout.write(`Created ${configPath}\n`);
  io.stdout.write(`Providers: ${result.providers.join(', ')}\n`);
  io.stdout.write(`Personas: ${result.personas.join(', ')}\n`);
  return 0;
}

async function promptInitProviders(
  flags: Record<string, string | boolean>,
  deps: CliDeps,
  io: CliIo,
): Promise<string[] | undefined> {
  if (flags.provider !== undefined || !deps.isInteractive()) return undefined;
  return deps.selectMany(
    'Select provider(s) to configure first',
    INIT_PROVIDERS.map((provider) => ({
      value: provider,
      label: provider,
      hint: `default model: ${defaultInitModel(provider)}`,
    })),
    [INIT_PROVIDERS[0]!],
    io,
  );
}

async function promptInitPersonas(
  flags: Record<string, string | boolean>,
  deps: CliDeps,
  io: CliIo,
): Promise<string[] | undefined> {
  if (flags.personas !== undefined || !deps.isInteractive()) return undefined;
  const templates = await loadInitPersonaTemplates();
  const entries = Object.entries(templates);
  return deps.selectMany(
    'Select persona(s) to enable',
    entries.map(([id, persona]) => ({
      value: id,
      label: id,
      hint: persona.description,
    })),
    entries.map(([id]) => id),
    io,
  );
}

async function promptInitModel(
  flags: Record<string, string | boolean>,
  selectedProviders: string[] | undefined,
  deps: CliDeps,
  io: CliIo,
): Promise<string | undefined> {
  if (flags.model !== undefined || !deps.isInteractive()) return undefined;
  const providers =
    selectedProviders ?? (typeof flags.provider === 'string' ? parseProviderSelection(flags.provider) : undefined);
  if (!providers || providers.length !== 1) return undefined;
  const provider = providers[0] as (typeof INIT_PROVIDERS)[number];
  const defaultModel = defaultInitModel(provider);
  const answer = await deps.prompt(`Model for ${provider} [${defaultModel}]: `, io);
  const model = answer.trim();
  return model || defaultModel;
}

function parseProviderSelection(value: string): string[] {
  const raw = value.trim();
  if (!raw) return [INIT_PROVIDERS[0]!];
  if (raw.toLowerCase() === 'all') return [...INIT_PROVIDERS];
  return parseSelection(value, [...INIT_PROVIDERS]);
}

function parseSelection(value: string, available: string[]): string[] {
  const raw = value.trim();
  if (!raw || raw.toLowerCase() === 'all') return available;
  const selected = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (/^\d+$/.test(item)) {
        const persona = available[Number(item) - 1];
        if (persona) return persona;
      }
      if (available.includes(item)) return item;
      throw new ConfigError(
        `Unsupported init selection "${item}"; expected numbers 1-${available.length}, ids, or "all"`,
      );
    });
  return [...new Set(selected)];
}

export function redactConfig(cfg: unknown, providerType?: string): unknown {
  if (isLazyEnvRef(cfg)) return '***redacted***';
  if (typeof cfg !== 'object' || cfg === null) return cfg;
  if (Array.isArray(cfg)) return cfg.map((v) => redactConfig(v, providerType));

  const obj = cfg as Record<string, unknown>;
  const typeFromConfig = typeof obj.type === 'string' ? obj.type : undefined;
  const effectiveType = typeFromConfig ?? providerType;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isSensitiveKey(k) || isProviderSensitiveField(effectiveType, k)) {
      out[k] = '***redacted***';
    } else {
      out[k] = redactConfig(v, k === 'type' ? providerType : effectiveType);
    }
  }
  return out;
}

function isProviderSensitiveField(providerType: string | undefined, key: string): boolean {
  if (!providerType) return false;
  const fields = getSensitiveFields(providerType);
  return fields?.has(key) ?? false;
}

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[\s-]/g, '_');
  return (
    k === 'apikey' ||
    k === 'api_key' ||
    k === 'token' ||
    k.endsWith('_token') ||
    k === 'secret' ||
    k.endsWith('_secret') ||
    k === 'password' ||
    k.endsWith('_password')
  );
}

function reviewOutputFormat(flags: Record<string, string | boolean>): 'text' | 'json' {
  if (flags.json === true) return 'json';
  if (flags.format === undefined) return 'text';
  if (flags.format === 'text' || flags.format === 'json') return flags.format;
  throw new ConfigError(`Unsupported review format "${String(flags.format)}"; expected "text" or "json"`);
}

function resolveConfigPath(
  root: string,
  value: string | boolean | undefined,
  deps: CliDeps,
): string {
  const path = typeof value === 'string' ? value : deps.findConfigPath(root);
  return resolve(root, path);
}

function assertPathInside(root: string, path: string): void {
  const rel = relative(resolve(root), resolve(path));
  if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) return;
  throw new ConfigError(`Refusing to write config outside repository: ${path}`);
}

function buildReviewInstruction(diff: string, files: string[]): string {
  const fileList = files.length > 0 ? `Changed files:\n${files.map((f) => `  - ${f}`).join('\n')}\n\n` : '';
  return `${fileList}Review the following diff and report findings as structured JSON per the system prompt.\n\n\`\`\`diff\n${diff}\n\`\`\``;
}

async function writeReport(path: string, content: string): Promise<void> {
  const dir = path.slice(0, path.lastIndexOf('/'));
  if (dir) {
    await mkdir(dir, { recursive: true });
  }
  await Bun.write(path, content);
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
