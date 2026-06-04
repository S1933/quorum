import type { ReviewResult, ModelConfig } from './task.ts';
import type { Finding, FindingGroup } from './finding.ts';

export interface ReviewerRef {
  id: string;
  personaId: string;
  providerId: string;
  providerConfig: unknown;
  overrides?: ModelConfig;
}

export interface ConsensusConfig {
  strategy: string;
  requireAgreement?: number;
  [key: string]: unknown;
}

export interface Pipeline {
  id: string;
  parallel: boolean;
  reviewers: string[];
  consensus?: ConsensusConfig;
  timeoutMs?: number;
  maxConcurrency?: number;
  maxReviewers?: number;
  maxTotalCostUsd?: number;
}

export interface ReviewerError {
  reviewerId: string;
  message: string;
  cause?: unknown;
}

export interface ConsensusResult {
  groups: FindingGroup[];
  agreement: Record<string, number>;
  unique: Finding[];
  contradictions: Array<{ groupId: string; reviewerA: string; reviewerB: string; note: string }>;
  strategyId: string;
}

export interface PipelineResult {
  pipelineId: string;
  reviews: ReviewResult[];
  consensus: ConsensusResult;
  durationMs: number;
  errors: ReviewerError[];
  budgetExceeded?: boolean;
  totalCostUsd?: number;
}
