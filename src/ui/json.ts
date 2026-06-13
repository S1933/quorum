import type { PipelineResult } from '../core/pipeline.ts';
import { toJsonReport } from './report-model.ts';

export type { JsonReport } from './report-model.ts';

export function renderJsonReport(result: PipelineResult): string {
  return `${JSON.stringify(toJsonReport(result), null, 2)}\n`;
}
