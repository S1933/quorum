import type { ReviewResult, WorkspaceInfo } from '../core/task.ts';
import type { Pipeline, PipelineResult, ReviewerError, ConsensusResult } from '../core/pipeline.ts';
import type { EventBus } from '../core/events.ts';
import type { BoundReviewer } from '../reviewers/reviewer.ts';
import type { ConsensusRegistry, MetaReviewFn, ConsensusContext } from '../consensus/registry.ts';
import type { PluginCtx } from '../runtime/plugin.ts';
import { ReviewerExecError } from '../core/errors.ts';
import { BudgetTracker } from './budget.ts';

export interface PipelineRunInput {
  pipeline: Pipeline;
  reviewers: BoundReviewer[];
  workspace: WorkspaceInfo;
  instruction: string;
  taskId: string;
  bus: EventBus;
  consensus: ConsensusRegistry;
  pluginCtx: PluginCtx;
  signal?: AbortSignal;
}

export class PipelineExecutor {
  async run(input: PipelineRunInput): Promise<PipelineResult> {
    const { pipeline, reviewers, bus, signal, workspace, instruction, taskId, consensus, pluginCtx } = input;
    const started = Date.now();

    bus.emit({
      type: 'pipeline.started',
      pipelineId: pipeline.id,
      reviewers: reviewers.map((r) => r.id),
    });

    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onParentAbort, { once: true });
    }

    let budgetExceeded = false;
    let budgetSpent = 0;
    const budgetTracker = new BudgetTracker(
      pipeline.maxTotalCostUsd !== undefined ? { maxTotalCostUsd: pipeline.maxTotalCostUsd } : {},
    );

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    if (pipeline.timeoutMs) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        bus.emit({ type: 'pipeline.timeout' });
        controller.abort();
      }, pipeline.timeoutMs);
    }

    const reviews: ReviewResult[] = [];
    const errors: ReviewerError[] = [];

    try {
      const runOne = async (rev: BoundReviewer, index: number): Promise<void> => {
        bus.emit({ type: 'reviewer.started', reviewerId: rev.id });
        try {
          const result = await rev.run(
            { id: `${taskId}:${rev.id}`, instruction, workspace },
            { bus, signal: controller.signal, workspace },
          );
          reviews[index] = result;

          const state = budgetTracker.record(result.usage);
          if (state.exceeded && !budgetExceeded) {
            budgetExceeded = true;
            budgetSpent = state.totalCostUsd;
            bus.emit({
              type: 'pipeline.budget_exceeded',
              spent: budgetSpent,
              limit: pipeline.maxTotalCostUsd ?? 0,
            });
            controller.abort();
          }

          bus.emit({ type: 'reviewer.finished', reviewerId: rev.id, result });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : `Unknown reviewer failure: ${String(err)}`;
          const wrapped =
            err instanceof ReviewerExecError
              ? err
              : new ReviewerExecError(rev.id, message, err);
          const reviewerError: ReviewerError = { reviewerId: rev.id, message: wrapped.message, cause: err };
          errors[index] = reviewerError;
          bus.emit({ type: 'reviewer.failed', reviewerId: rev.id, error: reviewerError });
        }
      };

      if (pipeline.parallel) {
        const limit = pipeline.maxConcurrency;
        if (limit && limit < reviewers.length) {
          await runWithConcurrencyLimit(reviewers, limit, runOne);
        } else {
          await Promise.all(reviewers.map((r, i) => runOne(r, i)));
        }
      } else {
        for (let i = 0; i < reviewers.length; i++) {
          if (controller.signal.aborted) break;
          await runOne(reviewers[i]!, i);
        }
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (signal) signal.removeEventListener('abort', onParentAbort);
    }

    const consensusResult = await computeConsensus(reviews.filter(Boolean), pipeline, consensus, pluginCtx);

    const result: PipelineResult = {
      pipelineId: pipeline.id,
      reviews: reviews.filter(Boolean),
      consensus: consensusResult,
      durationMs: Date.now() - started,
      errors: errors.filter(Boolean),
      ...(budgetExceeded ? { budgetExceeded: true } : {}),
      ...(budgetTracker.state().totalCostUsd > 0 ? { totalCostUsd: budgetTracker.state().totalCostUsd } : {}),
    };
    bus.emit({ type: 'pipeline.finished', result });
    if (timedOut) {
      // already emitted pipeline.timeout above
    }
    return result;
  }
}

async function runWithConcurrencyLimit(
  reviewers: BoundReviewer[],
  limit: number,
  runOne: (rev: BoundReviewer, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < reviewers.length) {
      const idx = next++;
      await runOne(reviewers[idx]!, idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, reviewers.length) }, () => worker()));
}

async function computeConsensus(
  reviews: ReviewResult[],
  pipeline: Pipeline,
  registry: ConsensusRegistry,
  pluginCtx: PluginCtx,
): Promise<ConsensusResult> {
  if (!pipeline.consensus) {
    return {
      groups: [],
      agreement: {},
      unique: reviews.flatMap((r) => r.findings),
      contradictions: [],
      strategyId: 'none',
    };
  }
  const strategy = registry.resolve(pipeline.consensus.strategy);

  const ctx: ConsensusContext | undefined =
    pipeline.consensus.metaReviewerProvider
      ? {
          metaReview: createMetaReviewFn(pipeline.consensus.metaReviewerProvider as Record<string, unknown>, pluginCtx),
        }
      : undefined;

  const result = strategy.aggregate(reviews, pipeline.consensus, ctx);
  return result instanceof Promise ? await result : result;
}

function createMetaReviewFn(
  providerCfg: Record<string, unknown>,
  pluginCtx: PluginCtx,
): MetaReviewFn {
  const type = String(providerCfg.type ?? 'claude-code');
  const model = String(providerCfg.model ?? '');

  return async (prompt: string): Promise<string> => {
    const args = buildMetaReviewArgs(type, model, prompt);
    const proc = Bun.spawn({
      cmd: args,
      stdout: 'pipe',
      stderr: 'pipe',
      env: pluginCtx.env as Record<string, string>,
    });

    const chunks: string[] = [];
    for await (const chunk of proc.stdout) {
      chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    }

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Meta-review provider "${type}" exited with code ${exitCode}: ${stderr.slice(0, 500)}`);
    }

    return chunks.join('').trim() || '{}';
  };
}

function buildMetaReviewArgs(type: string, model: string, prompt: string): string[] {
  switch (type) {
    case 'claude-code':
      return model ? ['claude', '-p', prompt, '--model', model] : ['claude', '-p', prompt];
    case 'codex-cli':
      return model
        ? ['codex', 'exec', '--prompt', prompt, '--model', model]
        : ['codex', 'exec', '--prompt', prompt];
    case 'gemini-cli':
      return model
        ? ['gemini', '-p', prompt, '--model', model]
        : ['gemini', '-p', prompt];
    case 'opencode':
      return model
        ? ['opencode', 'ask', prompt, '--model', model]
        : ['opencode', 'ask', prompt];
    case 'opencode-go':
      return model
        ? ['opencode', 'ask', prompt, '--model', model]
        : ['opencode', 'ask', prompt];
    case 'cursor-agent':
      return model
        ? ['cursor-agent', '-p', prompt, '--model', model]
        : ['cursor-agent', '-p', prompt];
    case 'kilo-code':
      return model
        ? ['kilo-code', '-p', prompt, '--model', model]
        : ['kilo-code', '-p', prompt];
    default:
      return model
        ? [type, '-p', prompt, '--model', model]
        : [type, '-p', prompt];
  }
}
