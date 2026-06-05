import type { ReviewResult, ModelConfig } from './task.ts';
import type { Finding, FindingGroup, Severity } from './finding.ts';

export interface ReviewerRef {
  id: string;
  personaId: string;
  providerId: string;
  providerConfig: unknown;
  overrides?: ModelConfig;
}

export interface ConsensusBaseConfig {
  requireAgreement?: number;
}

export interface OverlapV1ConsensusConfig extends ConsensusBaseConfig {
  strategy: 'overlap-v1';
}

export interface MajorityV1ConsensusConfig extends ConsensusBaseConfig {
  strategy: 'majority-v1';
}

export interface SeverityAwareV1ConsensusConfig extends ConsensusBaseConfig {
  strategy: 'severity-aware-v1';
  severityThresholds?: Partial<Record<Severity, number>>;
}

export interface SemanticV2ConsensusConfig extends ConsensusBaseConfig {
  strategy: 'semantic-v2';
  similarityThreshold?: number;
  enableContradictions?: boolean;
  metaReviewerProvider?: { type: string; [key: string]: unknown };
}

export type ConsensusConfig =
  | OverlapV1ConsensusConfig
  | MajorityV1ConsensusConfig
  | SeverityAwareV1ConsensusConfig
  | SemanticV2ConsensusConfig;

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
