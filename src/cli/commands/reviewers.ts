import type { QuorumConfig } from '../../config/schema.ts';
import type { CliDeps, CliIo } from '../types.ts';

export async function cmdReviewers(
  _positional: string[],
  flags: Record<string, string | boolean>,
  deps: CliDeps,
  io: CliIo,
): Promise<number> {
  const configPath = typeof flags.config === 'string' ? flags.config : deps.findConfigPath();
  const config = await deps.loadConfigFromPath(configPath);
  io.stdout.write(formatConfig(config));
  return 0;
}

function formatConfig(cfg: QuorumConfig): string {
  const lines: string[] = [];

  lines.push(`version: ${cfg.version}\n`);

  if (cfg.defaults?.pipeline) {
    lines.push(`defaults: pipeline=${cfg.defaults.pipeline}\n`);
  }

  lines.push('── Providers ──');
  for (const [id, p] of Object.entries(cfg.providers)) {
    const model = typeof p.model === 'string' ? ` (${p.model})` : '';
    lines.push(`  ${id}  type=${p.type}${model}`);
  }
  lines.push('');

  lines.push('── Personas ──');
  for (const [id, p] of Object.entries(cfg.personas)) {
    lines.push(`  ${id}  ${p.description}`);
  }
  lines.push('');

  lines.push('── Reviewers ──');
  for (const [id, r] of Object.entries(cfg.reviewers)) {
    const ext = r.fileExtensions?.length ? ` [${r.fileExtensions.join(', ')}]` : '';
    const ov = r.overrides ? ` (overrides: ${Object.entries(r.overrides).map(([k, v]) => `${k}=${v}`).join(', ')})` : '';
    lines.push(`  ${id}  persona=${r.persona}  provider=${r.provider}${ext}${ov}`);
  }
  lines.push('');

  lines.push('── Pipelines ──');
  for (const [id, p] of Object.entries(cfg.pipelines)) {
    const mode = p.parallel ? 'parallel' : 'sequential';
    const cs = p.consensus ? `  consensus=${p.consensus.strategy}` : '';
    const to = p.timeoutMs ? `  timeout=${p.timeoutMs}ms` : '';
    const mc = p.maxConcurrency ? `  maxConcurrency=${p.maxConcurrency}` : '';
    lines.push(`  ${id}  ${mode}`);
    if (cs) lines.push(`         ${cs}`);
    if (to) lines.push(`         ${to}`);
    if (mc) lines.push(`         ${mc}`);
    lines.push('         reviewers:');
    for (const rid of p.reviewers) {
      lines.push(`           - ${rid}`);
    }
  }

  return lines.join('\n') + '\n';
}