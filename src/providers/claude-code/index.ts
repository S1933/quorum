import type { MetaReviewFn } from '../../consensus/registry.ts';
import { REVIEW_OUTPUT_INSTRUCTIONS } from '../../reviewers/output.ts';
import { createSubprocessMetaReviewer } from '../subprocess.ts';
import { createSubprocessProvider } from '../base-subprocess.ts';
import { ClaudeCodeConfigSchema, type ClaudeCodeConfig } from './schema.ts';

export const claudeCodeFactory = createSubprocessProvider({
  type: 'claude-code',
  label: 'claude',
  schema: ClaudeCodeConfigSchema,
  buildStdin: (_, task) => task.instruction,
  processOutput: (raw) => raw,
  buildArgs: (cfg, _ctx, task) => {
    const c = cfg as ClaudeCodeConfig;
    return [
      '--print', '--model', c.model, ...c.extra_args,
      '--append-system-prompt', `${task.systemPrompt}\n\n${REVIEW_OUTPUT_INSTRUCTIONS}`,
    ];
  },
  createMetaReviewer: (config, ctx): MetaReviewFn | undefined => {
    const c = config as ClaudeCodeConfig;
    return createSubprocessMetaReviewer(
      c.binary, () => ['--print', '--model', c.model],
      c.cwd ?? ctx.workspaceRoot, c.timeout_ms,
    );
  },
});
