import type { PipelineResult, ReviewerError } from '../core/pipeline.ts';

export interface JsonReport {
  schemaVersion: 1;
  pipeline: {
    id: string;
    durationMs: number;
    reviewCount: number;
    errorCount: number;
  };
  reviews: Array<{
    taskId: string;
    reviewerId: string;
    durationMs: number;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      costUsd?: number;
    };
    findings: PipelineResult['reviews'][number]['findings'];
  }>;
  consensus: {
    strategyId: string;
    groups: Array<
      PipelineResult['consensus']['groups'][number] & {
        agreement: number;
      }
    >;
    unique: PipelineResult['consensus']['unique'];
    contradictions: PipelineResult['consensus']['contradictions'];
  };
  errors: Array<Pick<ReviewerError, 'reviewerId' | 'message'>>;
}

export function renderJsonReport(result: PipelineResult): string {
  const report: JsonReport = {
    schemaVersion: 1,
    pipeline: {
      id: result.pipelineId,
      durationMs: result.durationMs,
      reviewCount: result.reviews.length,
      errorCount: result.errors.length,
    },
    reviews: result.reviews.map((review) => {
      const out: JsonReport['reviews'][number] = {
        taskId: review.taskId,
        reviewerId: review.reviewerId,
        durationMs: review.durationMs,
        findings: review.findings,
      };
      if (review.usage) out.usage = review.usage;
      return out;
    }),
    consensus: {
      strategyId: result.consensus.strategyId,
      groups: result.consensus.groups.map((group) => ({
        ...group,
        agreement: result.consensus.agreement[group.id] ?? group.reviewers.length,
      })),
      unique: result.consensus.unique,
      contradictions: result.consensus.contradictions,
    },
    errors: result.errors.map((error) => ({
      reviewerId: error.reviewerId,
      message: error.message,
    })),
  };

  return `${JSON.stringify(report, null, 2)}\n`;
}
