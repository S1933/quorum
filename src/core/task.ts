import type { Finding } from './finding.ts';

export interface WorkspaceInfo {
  root: string;
  baseRef?: string;
  diff?: string;
  files?: string[];
}

export interface ModelConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface ReviewTask {
  kind: 'review';
  id: string;
  instruction: string;
  workspace: WorkspaceInfo;
  systemPrompt: string;
  reviewerId: string;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface ReviewResult {
  taskId: string;
  reviewerId: string;
  findings: Finding[];
  rawOutput: string;
  usage?: UsageInfo;
  durationMs: number;
}
