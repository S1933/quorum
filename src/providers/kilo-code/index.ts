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
    const model = ctx.modelOverride?.model ?? cfg.model;
    const args = ['run', ...cfg.extra_args];
    if (model) args.push('--model', model);
    if (cfg.agent) args.push('--agent', cfg.agent);
    if (cfg.variant) args.push('--variant', cfg.variant);
    if (cfg.format === 'json') args.push('--format', 'json');
    args.push('--', STDIN_PROMPT);
    return args;
  },
  createMetaReviewer: (config, ctx): MetaReviewFn | undefined => {
    return createSubprocessMetaReviewer(
      config.binary,
      () => ['run', '--', 'Read stdin and respond with JSON.'],
      config.cwd ?? ctx.workspaceRoot,
      config.timeout_ms,
    );
  },
});
