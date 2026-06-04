import type { MetaReviewFn } from '../../consensus/registry.ts';
import { normaliseSubprocessOutput, createSubprocessMetaReviewer } from '../subprocess.ts';
import { createSubprocessProvider, STDIN_PROMPT } from '../base-subprocess.ts';
import { ContinueDevConfigSchema, type ContinueDevConfig } from './schema.ts';

export const continueDevFactory = createSubprocessProvider({
  type: 'continue-dev',
  label: 'continue.dev',
  schema: ContinueDevConfigSchema,
  processOutput: (raw) => normaliseSubprocessOutput(raw),
  buildArgs: (cfg) => {
    const c = cfg as ContinueDevConfig;
    const args = ['-p', STDIN_PROMPT, ...c.extra_args];
    if (c.silent && !args.includes('--silent')) args.push('--silent');
    if (c.format === 'json') args.push('--format', 'json');
    if (c.config) args.push('--config', c.config);
    return args;
  },
  createMetaReviewer: (config, ctx): MetaReviewFn | undefined => {
    const c = config as ContinueDevConfig;
    return createSubprocessMetaReviewer(
      c.binary, () => ['-p', 'Read stdin and respond with JSON.', ...(c.silent ? ['--silent'] : [])],
      c.cwd ?? ctx.workspaceRoot, c.timeout_ms,
    );
  },
});
