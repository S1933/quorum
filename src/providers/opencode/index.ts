import type { MetaReviewFn } from '../../consensus/registry.ts';
import { normaliseSubprocessOutput, createSubprocessMetaReviewer } from '../subprocess.ts';
import { createSubprocessProvider, STDIN_PROMPT } from '../base-subprocess.ts';
import { OpenCodeConfigSchema, type OpenCodeConfig } from './schema.ts';

const mkBuilder = () => ({
  processOutput: (raw: string) => normaliseSubprocessOutput(raw),
  buildArgs: (cfg: OpenCodeConfig, ctx: import('../../core/provider.ts').ExecCtx) => {
    const model = ctx.modelOverride?.model ?? cfg.model;
    if (cfg.command_style === 'run') {
      const args = ['run', ...cfg.extra_args];
      if (model) args.push('--model', model);
      if (cfg.output_format === 'json') args.push('--format', 'json');
      if (cfg.quiet) args.push('--log-level', 'ERROR');
      args.push(STDIN_PROMPT);
      return args;
    }
    const args = ['--prompt', STDIN_PROMPT, ...cfg.extra_args];
    if (model) args.push('--model', model);
    if (cfg.output_format === 'json') args.push('-f', 'json');
    if (cfg.quiet) args.push('-q');
    return args;
  },
  createMetaReviewer: (config: unknown, ctx: import('../../runtime/plugin.ts').PluginCtx): MetaReviewFn | undefined => {
    const c = config as OpenCodeConfig;
    const args = c.command_style === 'run'
      ? ['run', ...(c.quiet ? ['--log-level', 'ERROR'] : []), 'Read stdin and respond with JSON.']
      : ['--prompt', 'Read stdin and respond with JSON.', ...(c.quiet ? ['-q'] : [])];
    return createSubprocessMetaReviewer(c.binary, () => args, c.cwd ?? ctx.workspaceRoot, c.timeout_ms);
  },
});

const builder = mkBuilder();

export const openCodeFactory = createSubprocessProvider({
  type: 'opencode',
  label: 'opencode',
  schema: OpenCodeConfigSchema,
  processOutput: builder.processOutput,
  buildArgs: builder.buildArgs,
  createMetaReviewer: builder.createMetaReviewer,
});

export const openCodeGoAliasFactory = createSubprocessProvider({
  type: 'opencode-go',
  label: 'opencode',
  schema: OpenCodeConfigSchema,
  processOutput: builder.processOutput,
  buildArgs: builder.buildArgs,
  createMetaReviewer: builder.createMetaReviewer,
});
