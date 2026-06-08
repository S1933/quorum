import type { ReviewResult, WorkspaceInfo, ReviewTask, PlanReviewVerdict } from '../core/task.ts';
import type { Pipeline, PipelineResult, ReviewerError, ConsensusResult } from '../core/pipeline.ts';
import type { EventBus } from '../core/events.ts';
import type { BoundReviewer } from '../reviewers/reviewer.ts';
import type { ConsensusRegistry, ConsensusContext, MetaReviewFn } from '../consensus/registry.ts';
import type { PluginCtx } from '../runtime/plugin.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
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
  providers: ProviderRegistry;
  pluginCtx: PluginCtx;
  taskKind?: ReviewTask['kind'];
  signal?: AbortSignal;
}

export class PipelineExecutor {
  async run(input: PipelineRunInput): Promise<PipelineResult> {
    const { pipeline, reviewers, bus, signal, workspace, instruction, taskId, consensus, providers, pluginCtx } = input;
    const taskKind = input.taskKind ?? 'review';
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
            { kind: taskKind, id: `${taskId}:${rev.id}`, instruction, workspace },
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
        const limit = effectiveConcurrencyLimit(pipeline, reviewers);
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

    const consensusResult = await computeConsensus(reviews.filter(Boolean), pipeline, consensus, providers, pluginCtx);

    const result: PipelineResult = {
      pipelineId: pipeline.id,
      reviews: reviews.filter(Boolean),
      consensus: consensusResult,
      durationMs: Date.now() - started,
      errors: errors.filter(Boolean),
      ...(taskKind === 'plan-review' ? { verdictSummary: buildVerdictSummary(reviews.filter(Boolean)) } : {}),
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

function effectiveConcurrencyLimit(pipeline: Pipeline, reviewers: BoundReviewer[]): number | undefined {
  const providerLimits = reviewers
    .map((reviewer) => reviewer.provider.capabilities().maxConcurrentReviews)
    .filter((limit): limit is number => limit !== undefined);
  const providerLimit = providerLimits.length > 0 ? Math.min(...providerLimits) : undefined;
  if (pipeline.maxConcurrency === undefined) return providerLimit;
  if (providerLimit === undefined) return pipeline.maxConcurrency;
  return Math.min(pipeline.maxConcurrency, providerLimit);
}

function buildVerdictSummary(reviews: ReviewResult[]): NonNullable<PipelineResult['verdictSummary']> {
  const counts: Record<PlanReviewVerdict['decision'], number> = {
    approve: 0,
    revise: 0,
    block: 0,
  };
  const summaries: NonNullable<PipelineResult['verdictSummary']>['summaries'] = [];

  for (const review of reviews) {
    if (!review.verdict) continue;
    counts[review.verdict.decision]++;
    const item: NonNullable<PipelineResult['verdictSummary']>['summaries'][number] = {
      reviewerId: review.reviewerId,
      decision: review.verdict.decision,
      summary: review.verdict.summary,
    };
    if (review.verdict.confidence) item.confidence = review.verdict.confidence;
    summaries.push(item);
  }

  const decision = counts.block > 0 ? 'block' : counts.revise > 0 ? 'revise' : 'approve';
  return { decision, counts, summaries };
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
  providers: ProviderRegistry,
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

  const metaReview = pipeline.consensus.strategy === 'semantic-v2' && pipeline.consensus.metaReviewerProvider
    ? resolveMetaReviewer(pipeline.consensus.metaReviewerProvider, providers, pluginCtx)
    : undefined;

  const ctx: ConsensusContext | undefined = metaReview ? { metaReview } : undefined;

  const result = strategy.aggregate(reviews, pipeline.consensus, ctx);
  return result instanceof Promise ? await result : result;
}

function resolveMetaReviewer(
  providerCfg: Record<string, unknown>,
  providers: ProviderRegistry,
  pluginCtx: PluginCtx,
): MetaReviewFn | undefined {
  const type = String(providerCfg.type ?? '');
  if (!type) return undefined;
  const factory = providers.resolve(type);
  if (!factory?.createMetaReviewer) return undefined;
  return factory.createMetaReviewer(providerCfg, pluginCtx);
}
