import type { MetaReviewFn } from '../../consensus/registry.ts';
import { createSubprocessProvider, STDIN_PROMPT } from '../base-subprocess.ts';
import { createSubprocessMetaReviewer } from '../subprocess.ts';
import { type GeminiCliConfig, GeminiCliConfigSchema } from './schema.ts';

export const geminiCliFactory = createSubprocessProvider({
  type: 'gemini-cli',
  label: 'gemini',
  schema: GeminiCliConfigSchema,
  processOutput: (raw) => raw.trim(),
  buildArgs: (cfg, ctx) => {
    const c = cfg as GeminiCliConfig;
    const model = ctx.modelOverride?.model ?? c.model;
    const args = [
      '--prompt',
      STDIN_PROMPT,
      '--approval-mode',
      c.approval_mode,
      '--output-format',
      'text',
      ...c.extra_args,
    ];
    if (c.sandbox) args.push('--sandbox');
    if (c.skip_trust) args.push('--skip-trust');
    if (model) args.push('--model', model);
    return args;
  },
  createMetaReviewer: (config, ctx): MetaReviewFn | undefined => {
    const c = config as GeminiCliConfig;
    return createSubprocessMetaReviewer(
      c.binary,
      () => {
        const args = [
          '--approval-mode',
          c.approval_mode,
          '--output-format',
          'text',
        ];
        if (c.sandbox) args.push('--sandbox');
        if (c.skip_trust) args.push('--skip-trust');
        return args;
      },
      c.cwd ?? ctx.workspaceRoot,
      c.timeout_ms,
    );
  },
});
