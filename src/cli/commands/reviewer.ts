import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { resolve, join } from 'node:path';
import { Faker, base as fakerBase, fr } from '@faker-js/faker';
import type { CliDeps, CliIo } from '../types.ts';

const PKG_ROOT = resolve(import.meta.dir, '..', '..', '..');
const EXAMPLE_PATH = join(PKG_ROOT, 'quorum.yaml.example');

const SUPPORTED_PROVIDERS = [
  'openrouter',
  'claude-code',
  'codex-cli',
  'continue-dev',
  'cursor-agent',
  'gemini-cli',
  'kilo-code',
  'opencode-go',
  'ollama',
] as const;

const REVIEWER_ADD_USAGE = 'Usage: quorum reviewer add --provider=<type> --persona=<name> --model=<model> [--id=<reviewer-id>] [--ext=<ext1,ext2,...>] [--pipeline=<id>]\n';

export async function cmdReviewer(
  positional: string[],
  flags: Record<string, string | boolean>,
  deps: CliDeps,
  io: CliIo,
): Promise<number> {
  const sub = positional[0];
  if (!sub) {
    io.stderr.write(REVIEWER_ADD_USAGE);
    return 2;
  }

  switch (sub) {
    case 'add':
      return await cmdReviewerAdd(flags, deps, io);
    default:
      io.stderr.write(`Unknown subcommand: reviewer ${sub}\n\n`);
      io.stderr.write(REVIEWER_ADD_USAGE);
      return 2;
  }
}

async function cmdReviewerAdd(
  flags: Record<string, string | boolean>,
  deps: CliDeps,
  io: CliIo,
): Promise<number> {
  const configPath = typeof flags.config === 'string' ? flags.config : deps.findConfigPath();
  const inited = await deps.initConfigIfMissing?.(configPath, EXAMPLE_PATH);
  if (inited) {
    io.stdout.write(`inited quorum config from example: ${configPath}\n`);
  }

  const config = await deps.loadConfigFromPath(configPath);

  const provider = typeof flags.provider === 'string' ? flags.provider : null;
  const persona = typeof flags.persona === 'string' ? flags.persona : null;
  const model = typeof flags.model === 'string' ? flags.model : null;
  const extensions = parseExtensions(flags);

  if (!provider) {
    io.stderr.write('Missing --provider flag\n');
    return 1;
  }
  if (!persona) {
    io.stderr.write('Missing --persona flag\n');
    return 1;
  }
  if (!model) {
    io.stderr.write('Missing --model flag\n');
    return 1;
  }

  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
    io.stderr.write(`Unknown provider type "${provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}\n`);
    return 1;
  }

  if (!config.personas[persona]) {
    io.stderr.write(`Unknown persona "${persona}". Available: ${Object.keys(config.personas).join(', ') || '(none)'}\n`);
    return 1;
  }

  const providerEntry: Record<string, unknown> = { type: provider, model };
  const newEntry: Record<string, unknown> = { persona, provider: providerEntry };
  if (extensions) newEntry.fileExtensions = extensions;
  const reviewerId = typeof flags.id === 'string'
    ? flags.id
    : resolveReviewerId(persona, provider, newEntry, config.reviewers);

  if (config.reviewers[reviewerId]) {
    io.stdout.write(`Reviewer "${reviewerId}" already exists — skipping.\n`);
    return 0;
  }

  const pipelineId = typeof flags.pipeline === 'string'
    ? flags.pipeline
    : config.defaults?.pipeline ?? 'default';

  if (!config.pipelines[pipelineId]) {
    io.stderr.write(`Unknown pipeline "${pipelineId}". Available: ${Object.keys(config.pipelines).join(', ') || '(none)'}\n`);
    return 1;
  }

  const raw = await deps.readConfigFile!(configPath);
  const doc = parseYaml(raw);
  const d = (doc && typeof doc === 'object' ? doc : {}) as Record<string, unknown>;

  if (!d.reviewers || typeof d.reviewers !== 'object') {
    d.reviewers = {};
  }
  (d.reviewers as Record<string, unknown>)[reviewerId] = newEntry;

  if (d.pipelines && typeof d.pipelines === 'object') {
    const pipelines = d.pipelines as Record<string, unknown>;
    const pipeline = pipelines[pipelineId] as Record<string, unknown> | undefined;
    if (pipeline && Array.isArray(pipeline.reviewers)) {
      if (!pipeline.reviewers.includes(reviewerId)) {
        pipeline.reviewers.push(reviewerId);
      }
    }
  }

  await deps.writeConfigFile!(configPath, stringifyYaml(d));
  io.stdout.write(`added reviewer "${reviewerId}"  persona=${persona}  provider=${provider}${model ? ` (${model})` : ''}${extensions ? ` [${extensions.join(', ')}]` : ''}\n`);

  return 0;
}

function parseExtensions(flags: Record<string, string | boolean>): string[] | null {
  const raw = typeof flags.ext === 'string'
    ? flags.ext.split(',').map((s) => s.trim()).filter(Boolean)
    : flags.ext;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((s) => String(s).trim()).filter(Boolean);
}

function resolveReviewerId(
  persona: string,
  provider: string,
  target: Record<string, unknown>,
  existing: Record<string, unknown>,
): string {
  for (const [id, cfg] of Object.entries(existing)) {
    if (hasReviewerNamePrefix(id, persona, provider) && reviewerEntryMatches(cfg, target)) return id;
  }

  for (const [id, cfg] of Object.entries(existing)) {
    if (!hasReviewerNamePrefix(id, persona, provider) && reviewerEntryMatches(cfg, target)) return id;
  }

  const base = `${persona}-${provider}`;
  const usedNames = usedReviewerNamePrefixes(existing);
  const candidates = reviewerNameCandidates(base, existing);
  const availableName = candidates.find((name) => !usedNames.has(name) && !existing[`${name}-${base}`]);
  if (availableName) return `${availableName}-${base}`;

  let n = 2;
  const fallbackName = candidates[0] ?? 'reviewer';
  let id = `${fallbackName}-${base}-${n}`;
  while (existing[id]) {
    n += 1;
    id = `${fallbackName}-${base}-${n}`;
  }
  return id;
}

function reviewerNameCandidates(base: string, existing: Record<string, unknown>): string[] {
  const faker = new Faker({ locale: [fr, fakerBase] });
  faker.seed(stableSeed([base, ...Object.keys(existing).sort()].join('|')));

  const candidates: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 100; i += 1) {
    const name = slugPart(faker.person.firstName());
    if (name && !seen.has(name)) {
      seen.add(name);
      candidates.push(name);
    }
  }
  return candidates;
}

function stableSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function slugPart(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function usedReviewerNamePrefixes(existing: Record<string, unknown>): Set<string> {
  const used = new Set<string>();
  for (const id of Object.keys(existing)) {
    const name = id.split('-')[0];
    if (name) used.add(name);
  }
  return used;
}

function hasReviewerNamePrefix(id: string, persona: string, provider: string): boolean {
  const suffix = `-${persona}-${provider}`;
  return id.endsWith(suffix) && id.length > suffix.length;
}

function reviewerEntryMatches(actual: unknown, target: Record<string, unknown>): boolean {
  if (!actual || typeof actual !== 'object') return false;
  const a = actual as Record<string, unknown>;
  return (
    a.persona === target.persona
    && deepEqual(a.provider, target.provider)
    && deepEqual(a.fileExtensions ?? [], target.fileExtensions ?? [])
  );
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => deepEqual(v, b[i]));
    }
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => deepEqual(aObj[k], bObj[k]));
  }
  return false;
}
