import type { MetaReviewFn } from '../../consensus/registry.ts';
import { createSubprocessProvider, STDIN_PROMPT } from '../base-subprocess.ts';
import {
  createSubprocessMetaReviewer,
  normaliseSubprocessOutput,
} from '../subprocess.ts';
import { KiloCodeConfigSchema } from './schema.ts';

export const kiloCodeFactory = createSubprocessProvider({
  type: 'kilo-code',
  label: 'kilo',
  schema: KiloCodeConfigSchema,
  processOutput: (raw) => normaliseSubprocessOutput(raw),
  buildArgs: (cfg, ctx) => {
    const c = KiloCodeConfigSchema.parse(cfg);
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
    const c = KiloCodeConfigSchema.parse(config);
    return createSubprocessMetaReviewer(
      c.binary,
      () => ['run', '--', 'Read stdin and respond with JSON.'],
      c.cwd ?? ctx.workspaceRoot,
      c.timeout_ms,
    );
  },
});
