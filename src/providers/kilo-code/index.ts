import type { MetaReviewFn } from '../../consensus/registry.ts';
import { normaliseSubprocessOutput, createSubprocessMetaReviewer } from '../subprocess.ts';
import { createSubprocessProvider, STDIN_PROMPT } from '../base-subprocess.ts';
import { KiloCodeConfigSchema, type KiloCodeConfig } from './schema.ts';

export const kiloCodeFactory = createSubprocessProvider({
  type: 'kilo-code',
  label: 'kilo',
  schema: KiloCodeConfigSchema,
  processOutput: (raw) => normaliseSubprocessOutput(raw),
  buildArgs: (cfg, ctx) => {
    const c = cfg as KiloCodeConfig;
    const model = ctx.modelOverride?.model ?? c.model;
    const args = ['run', ...c.extra_args];
    if (model) args.push('--model', model);
    if (c.agent) args.push('--agent', c.agent);
    if (c.variant) args.push('--variant', c.variant);
    if (c.format === 'json') args.push('--format', 'json');
    args.push('--', STDIN_PROMPT);
    return args;
  },
  createMetaReviewer: (config, ctx): MetaReviewFn | undefined => {
    const c = config as KiloCodeConfig;
    return createSubprocessMetaReviewer(
      c.binary, () => ['run', '--', 'Read stdin and respond with JSON.'],
      c.cwd ?? ctx.workspaceRoot, c.timeout_ms,
    );
  },
});
