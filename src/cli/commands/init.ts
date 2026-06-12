import { createInterface, type Interface } from 'node:readline';
import { resolve, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { CliDeps, CliIo } from '../types.ts';
import {
  SUPPORTED_PROVIDERS,
  EXAMPLE_PATH,
  addReviewerToConfig,
  type AddReviewerParams,
} from './reviewer.ts';
import { findConfigPath } from '../../config/loader.ts';
import type { QuorumConfig } from '../../config/schema.ts';

const BINARIES: Record<string, string> = {
  'claude-code': 'claude',
  'codex-cli': 'codex',
  'gemini-cli': 'gemini',
  'continue-dev': 'continue',
  'cursor-agent': 'cursor-agent',
  'kilo-code': 'kilocode',
  'opencode': 'opencode',
};

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: 'OpenRouter (API)',
  ollama: 'Ollama (local)',
  'claude-code': 'Claude Code CLI',
  'codex-cli': 'Codex CLI',
  'gemini-cli': 'Gemini CLI',
  'continue-dev': 'Continue.dev',
  'cursor-agent': 'Cursor Agent',
  'kilo-code': 'Kilo Code',
  opencode: 'OpenCode',
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  openrouter: 'API-based — needs OPENROUTER_API_KEY env var',
  ollama: 'Local — needs Ollama instance on localhost:11434',
  'claude-code': 'Subprocess — needs `claude` CLI installed',
  'codex-cli': 'Subprocess — needs `codex` CLI installed',
  'gemini-cli': 'Subprocess — needs `gemini` CLI installed',
  'continue-dev': 'Subprocess — bundled with Continue.dev IDE',
  'cursor-agent': 'Subprocess — bundled with Cursor IDE',
  'kilo-code': 'Subprocess — needs `kilocode` CLI installed',
  opencode: 'Subprocess — needs `opencode` CLI installed',
};

const DEFAULT_MODELS: Record<string, string> = {
  openrouter: 'anthropic/claude-sonnet-4',
  ollama: 'llama3.2:latest',
  subprocess: '',
};

function getDefaultModel(provider: string): string {
  return DEFAULT_MODELS[provider] ?? DEFAULT_MODELS['subprocess']!;
}

function isSubprocessProvider(provider: string): boolean {
  return BINARIES[provider] !== undefined;
}

async function detectAvailableProviders(): Promise<Set<string>> {
  const available = new Set<string>();

  for (const provider of SUPPORTED_PROVIDERS) {
    if (provider === 'openrouter') {
      available.add(provider);
    } else if (provider === 'ollama') {
      available.add(provider);
    } else {
      const binary = BINARIES[provider];
      if (binary) {
        const found = await Bun.which(binary);
        if (found) available.add(provider);
      }
    }
  }

  return available;
}

export async function cmdInit(
  _positional: string[],
  flags: Record<string, string | boolean>,
  deps: CliDeps,
  io: CliIo,
): Promise<number> {
  const configPath = typeof flags.config === 'string' ? flags.config : findConfigPath();
  const inited = await deps.initConfigIfMissing?.(configPath, EXAMPLE_PATH);
  if (inited) {
    io.stdout.write('Created quorum.yaml from example.\n');
  }

  const config = await deps.loadConfigFromPath(configPath);
  const available = await detectAvailableProviders();

  if (!io.stdin || !io.stdin.isTTY) {
    io.stderr.write('Init requires an interactive terminal.\n');
    return 1;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    io.stdout.write('\n');
    io.stdout.write('┌─ Quorum Setup ─────────────────────────────┐\n');
    io.stdout.write('│ This will add your first reviewer.        │\n');
    io.stdout.write('│ Run again to add more reviewers later.    │\n');
    io.stdout.write('└────────────────────────────────────────────┘\n');

    // ── 1. Provider selection ──────────────────────────────
    const provider = await selectProvider(rl, io, available);

    // ── 2. Persona selection ────────────────────────────────
    const persona = await selectPersona(rl, io, config);

    // ── 3. Model ────────────────────────────────────────────
    const defaultModel = getDefaultModel(provider);
    const model = await askModel(rl, io, provider, defaultModel);

    // ── 4. Pipeline ─────────────────────────────────────────
    const pipelineId = await selectPipeline(rl, io, config);

    const params: AddReviewerParams = {
      provider,
      persona,
      model,
      pipelineId,
    };

    const result = await addReviewerToConfig(params, config, configPath, deps);
    if (result.alreadyExisted) {
      io.stdout.write(`\n✓ Reviewer "${result.reviewerId}" already exists in pipeline "${pipelineId}".\n`);
    } else {
      io.stdout.write(`\n✓ Reviewer "${result.reviewerId}" added to pipeline "${pipelineId}".\n`);
    }

    // ── 5. Env var setup if needed ──────────────────────────
    if (provider === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
      await offerDotEnv(rl, io, configPath);
    }

    const pkgs: string[] = [];
    if (isSubprocessProvider(provider)) {
      const binary = BINARIES[provider]!;
      if (!(await Bun.which(binary))) {
        pkgs.push(binary);
      }
    }
    if (pkgs.length > 0) {
      io.stdout.write(`\n⚠  CLI not found in PATH. Install it first:\n`);
      for (const pkg of pkgs) {
        io.stdout.write(`     npm install -g ${pkg}\n`);
      }
    }

    io.stdout.write(`\nRun your first review:\n`);
    io.stdout.write(`  quorum review\n`);

    return 0;
  } finally {
    rl.close();
  }
}

async function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolveFn) => {
    rl.question(question, (answer: string) => resolveFn(answer.trim()));
  });
}

// ── Provider selection ────────────────────────────────────────
async function selectProvider(
  rl: Interface,
  io: CliIo,
  available: Set<string>,
): Promise<string> {
  const items = SUPPORTED_PROVIDERS.map((p) => {
    const marker = available.has(p) ? '✓' : '✗';
    const desc = PROVIDER_DESCRIPTIONS[p] ?? '';
    const label = `[${marker}] ${PROVIDER_LABELS[p] ?? p}  — ${desc}`;
    return { value: p, label, available: available.has(p) };
  });

  io.stdout.write('\nSelect an AI provider:\n');
  for (const [i, item] of items.entries()) {
    io.stdout.write(`  ${i + 1}. ${item.label}\n`);
  }

  while (true) {
    const answer = await ask(rl, `Provider (1-${items.length}) [1]: `);
    const num = answer === '' ? 1 : parseInt(answer, 10);
    if (num >= 1 && num <= items.length) {
      return items[num - 1]!.value;
    }
    io.stdout.write(`Please enter a number between 1 and ${items.length}.\n`);
  }
}

// ── Persona selection ─────────────────────────────────────────
async function selectPersona(
  rl: Interface,
  io: CliIo,
  config: QuorumConfig,
): Promise<string> {
  const personas = Object.entries(config.personas);
  if (personas.length === 0) {
    throw new Error('No personas defined in config.');
  }

  io.stdout.write('\nSelect a review persona:\n');
  for (const [i, [id, p]] of personas.entries()) {
    io.stdout.write(`  ${i + 1}. ${id}  — ${p.description}\n`);
  }

  while (true) {
    const answer = await ask(rl, `Persona (1-${personas.length}) [1]: `);
    const num = answer === '' ? 1 : parseInt(answer, 10);
    if (num >= 1 && num <= personas.length) {
      return personas[num - 1]![0];
    }
    io.stdout.write(`Please enter a number between 1 and ${personas.length}.\n`);
  }
}

// ── Model prompt ──────────────────────────────────────────────
async function askModel(
  rl: Interface,
  io: CliIo,
  _provider: string,
  defaultModel: string,
): Promise<string> {
  if (!defaultModel) {
    io.stdout.write(`\nModel (leave empty for provider default):\n`);
  } else {
    io.stdout.write(`\nModel (press Enter for default "${defaultModel}"):\n`);
  }
  while (true) {
    const answer = await ask(rl, 'Model: ');
    if (answer === '') {
      if (defaultModel) return defaultModel;
      continue; // empty not allowed for providers that require a model
    }
    return answer;
  }
}

// ── Pipeline selection ────────────────────────────────────────
async function selectPipeline(
  rl: Interface,
  io: CliIo,
  config: QuorumConfig,
): Promise<string> {
  const pipelines = Object.keys(config.pipelines);
  if (pipelines.length === 0) {
    throw new Error('No pipelines defined in config.');
  }

  const defaultPipeline = config.defaults?.pipeline ?? pipelines[0] ?? 'default';

  io.stdout.write('\nSelect a pipeline to add the reviewer to:\n');
  for (const [i, id] of pipelines.entries()) {
    const isDefault = id === defaultPipeline ? ' (default)' : '';
    io.stdout.write(`  ${i + 1}. ${id}${isDefault}\n`);
  }

  while (true) {
    const defaultIdx = pipelines.indexOf(defaultPipeline) + 1;
    const answer = await ask(rl, `Pipeline (1-${pipelines.length}) [${defaultIdx}]: `);
    if (answer === '') {
      return defaultPipeline;
    }
    const num = parseInt(answer, 10);
    if (num >= 1 && num <= pipelines.length) {
      return pipelines[num - 1]!;
    }
    io.stdout.write(`Please enter a number between 1 and ${pipelines.length}.\n`);
  }
}

// ── .env file offer ───────────────────────────────────────────
async function offerDotEnv(
  rl: Interface,
  io: CliIo,
  configPath: string,
): Promise<void> {
  const envPath = resolve(join(configPath, '..', '.env'));

  io.stdout.write(
    '\nOPENROUTER_API_KEY is not set. Would you like to create a .env file now?\n',
  );

  const answer = await ask(rl, 'Create .env? (y/N): ');
  if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
    io.stdout.write('Skipped. Set OPENROUTER_API_KEY manually to proceed.\n');
    return;
  }

  const key = await ask(rl, 'Paste your OpenRouter API key: ');
  if (!key) {
    io.stdout.write('No key provided. Skipping .env creation.\n');
    return;
  }

  const envContent = `# Quorum — environment variables\nOPENROUTER_API_KEY=${key}\n`;
  if (await Bun.file(envPath).exists()) {
    const append = await ask(rl, '.env already exists. Append to it? (y/N): ');
    if (append.toLowerCase() === 'y' || append.toLowerCase() === 'yes') {
      const existing = await Bun.file(envPath).text();
      if (existing.includes('OPENROUTER_API_KEY')) {
        io.stdout.write('OPENROUTER_API_KEY already in .env. Skipping.\n');
        return;
      }
      await writeFile(envPath, existing + '\n' + envContent, 'utf-8');
    } else {
      io.stdout.write('Skipped.\n');
      return;
    }
  } else {
    await writeFile(envPath, envContent, 'utf-8');
  }

  io.stdout.write(`✓ Wrote OPENROUTER_API_KEY to ${envPath}\n`);
  io.stdout.write('  (Quorum reads .env automatically when available)\n');
}
