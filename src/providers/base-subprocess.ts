import type { z } from 'zod';
import type { Provider, ProviderCapabilities, ExecCtx } from '../core/provider.ts';
import type { ReviewTask, ReviewResult } from '../core/task.ts';
import type { ProviderFactory } from './registry.ts';
import type { PluginCtx } from '../runtime/plugin.ts';
import type { MetaReviewFn } from '../consensus/registry.ts';
import { REVIEW_OUTPUT_INSTRUCTIONS } from '../reviewers/output.ts';
import { runSubprocess, buildSubprocessReviewResult } from './subprocess.ts';

export const STDIN_PROMPT = 'Read the review instructions from stdin and return only the requested output.';

export interface SubprocessBaseConfig {
  binary: string;
  allow_project_binary: boolean;
  cwd?: string | undefined;
  timeout_ms: number;
}

export interface SubprocessProviderOpts {
  type: string;
  label: string;
  schema: z.ZodTypeAny;
  buildArgs(cfg: SubprocessBaseConfig, ctx: ExecCtx, task: ReviewTask, cwd: string): string[];
  buildStdin?(cfg: SubprocessBaseConfig, task: ReviewTask): string;
  processOutput?(raw: string, _cfg: SubprocessBaseConfig): string;
  env?(cfg: SubprocessBaseConfig): Record<string, string | undefined> | undefined;
  createMetaReviewer?(config: unknown, ctx: PluginCtx): MetaReviewFn | undefined;
}

const DEFAULT_STDIN = (_cfg: SubprocessBaseConfig, task: ReviewTask): string =>
  [task.systemPrompt, REVIEW_OUTPUT_INSTRUCTIONS, task.instruction].join('\n\n');

export function createSubprocessProvider(opts: SubprocessProviderOpts): ProviderFactory {
  const buildStdin = opts.buildStdin ?? DEFAULT_STDIN;
  const processOutput = opts.processOutput ?? ((raw: string) => raw);

  class Impl implements Provider {
    private readonly cfg: SubprocessBaseConfig;

    constructor(
      readonly id: string,
      config: unknown,
      private readonly pluginCtx: PluginCtx,
    ) {
      this.cfg = config as SubprocessBaseConfig;
    }

    capabilities(): ProviderCapabilities {
      return {
        review: true,
        streaming: false,
        tools: true,
        mcp: true,
        localExecution: true,
      };
    }

    async review(task: ReviewTask, ctx: ExecCtx): Promise<ReviewResult> {
      const started = Date.now();
      const cwd = this.cfg.cwd ?? this.pluginCtx.workspaceRoot;
      const optsEnv = opts.env?.(this.cfg);

      const runOpts: Parameters<typeof runSubprocess>[0] = {
        providerId: this.id,
        providerLabel: opts.label,
        reviewerId: task.reviewerId,
        binary: this.cfg.binary,
        allowProjectBinary: this.cfg.allow_project_binary,
        args: opts.buildArgs(this.cfg, ctx, task, cwd),
        cwd,
        stdin: buildStdin(this.cfg, task),
        timeoutMs: this.cfg.timeout_ms,
        signal: ctx.signal,
        bus: ctx.bus,
      };
      if (optsEnv) runOpts.env = optsEnv;

      const raw = await runSubprocess(runOpts);
      return buildSubprocessReviewResult(task, processOutput(raw, this.cfg), started, ctx.bus);
    }
  }

  return {
    type: opts.type,
    schema: opts.schema,
    async create(instanceId, config, ctx) {
      return new Impl(instanceId, config, ctx);
    },
    ...(opts.createMetaReviewer ? { createMetaReviewer: opts.createMetaReviewer } : {}),
  };
}
