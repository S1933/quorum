import type { MetaReviewFn } from '../../consensus/registry.ts';
import { createSubprocessProvider } from '../base-subprocess.ts';
import {
  createSubprocessMetaReviewer,
  normaliseSubprocessOutput,
} from '../subprocess.ts';
import { CursorAgentConfigSchema } from './schema.ts';

const CURSOR_UNWRAP_KEYS = ['output', 'response', 'text', 'content', 'result'];

export const cursorAgentFactory = createSubprocessProvider({
  type: 'cursor-agent',
  label: 'cursor-agent',
  schema: CursorAgentConfigSchema,
  processOutput: (raw) => normaliseSubprocessOutput(raw, CURSOR_UNWRAP_KEYS),
  env: (cfg) => {
    return cfg.api_key ? { CURSOR_API_KEY: cfg.api_key } : undefined;
  },
  buildArgs: (cfg, ctx) => {
    const model = ctx.modelOverride?.model ?? cfg.model;
    const args = [
      '--print',
      'Read the review instructions from stdin and return only the requested output.',
      '--output-format',
      cfg.output_format,
      ...cfg.extra_args,
    ];
    if (model) args.push('--model', model);
    return args;
  },
  createMetaReviewer: (config, ctx): MetaReviewFn | undefined => {
    return createSubprocessMetaReviewer(
      config.binary,
      () => [
        '--print',
        'Read stdin and respond with JSON.',
        '--output-format',
        config.output_format,
      ],
      config.cwd ?? ctx.workspaceRoot,
      config.timeout_ms,
      config.api_key ? { CURSOR_API_KEY: config.api_key } : undefined,
    );
  },
});
