import type { MetaReviewFn } from '../../consensus/registry.ts';
import { normaliseSubprocessOutput, createSubprocessMetaReviewer } from '../subprocess.ts';
import { createSubprocessProvider } from '../base-subprocess.ts';
import { CursorAgentConfigSchema, type CursorAgentConfig } from './schema.ts';
import type { SubprocessBaseConfig } from '../base-subprocess.ts';

const CURSOR_UNWRAP_KEYS = ['output', 'response', 'text', 'content', 'result'];

export const cursorAgentFactory = createSubprocessProvider({
  type: 'cursor-agent',
  label: 'cursor-agent',
  schema: CursorAgentConfigSchema,
  processOutput: (raw) => normaliseSubprocessOutput(raw, CURSOR_UNWRAP_KEYS),
  env: (cfg: SubprocessBaseConfig) => {
    const c = cfg as CursorAgentConfig;
    return c.api_key ? { CURSOR_API_KEY: c.api_key } : undefined;
  },
  buildArgs: (cfg, ctx) => {
    const c = cfg as CursorAgentConfig;
    const model = ctx.modelOverride?.model ?? c.model;
    const args = [
      '--print',
      'Read the review instructions from stdin and return only the requested output.',
      '--output-format', c.output_format,
      ...c.extra_args,
    ];
    if (model) args.push('--model', model);
    return args;
  },
  createMetaReviewer: (config, ctx): MetaReviewFn | undefined => {
    const c = config as CursorAgentConfig;
    return createSubprocessMetaReviewer(
      c.binary,
      () => ['--print', 'Read stdin and respond with JSON.', '--output-format', c.output_format],
      c.cwd ?? ctx.workspaceRoot, c.timeout_ms,
      c.api_key ? { CURSOR_API_KEY: c.api_key } : undefined,
    );
  },
});
