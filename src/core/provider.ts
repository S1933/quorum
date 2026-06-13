import type { EventBus } from './events.ts';
import type { Finding } from './finding.ts';
import type {
  ModelConfig,
  ReviewResult,
  ReviewTask,
  WorkspaceInfo,
} from './task.ts';

export interface ProviderCapabilities {
  review: boolean;
  streaming: boolean;
  tools: boolean;
  mcp: boolean;
  localExecution: boolean;
  maxConcurrentReviews?: number;
}

export type ProviderEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'finding'; finding: Finding }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; msg: string }
  | {
      type: 'usage';
      inputTokens: number;
      outputTokens: number;
      costUsd?: number;
    };

export interface ExecCtx {
  bus: EventBus;
  signal: AbortSignal;
  workspace: WorkspaceInfo;
  modelOverride?: ModelConfig;
  reviewerId?: string;
}

export interface Provider {
  readonly id: string;

  capabilities(): ProviderCapabilities;

  review?(task: ReviewTask, ctx: ExecCtx): Promise<ReviewResult>;
  dispose?(): Promise<void>;
}
