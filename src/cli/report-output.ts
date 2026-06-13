import type { PipelineResult } from '../core/pipeline.ts';
import { renderJsonReport } from '../ui/json.ts';
import { renderMarkdownReport } from '../ui/markdown.ts';
import { resolveReportPath, writeArchivedReport, writeReport } from './report.ts';
import type { CliIo } from './types.ts';

export interface ReportOutputParams {
  result: PipelineResult;
  format: 'text' | 'json';
  flags: Record<string, string | boolean>;
  root: string;
  io: CliIo;
  archiveKind: string;
  defaultReportName: string;
  pipelineId: string;
}

export async function writeOutputReport(
  params: ReportOutputParams,
): Promise<number> {
  const { result, format, flags, root, io, archiveKind, defaultReportName, pipelineId } = params;

  if (format === 'json') {
    const json = renderJsonReport(result);
    if (typeof flags.report === 'string') {
      const reportPath = resolveReportPath(root, flags.report, flags['allow-report-outside-root'] === true);
      await writeReport(reportPath, json);
    }
    io.stdout.write(json);
  } else {
    const reportPath =
      typeof flags.report === 'string'
        ? resolveReportPath(root, flags.report, flags['allow-report-outside-root'] === true)
        : `${root}/.quorum/${defaultReportName}`;
    const md = renderMarkdownReport(result);
    await writeReport(reportPath, md);
    await writeArchivedReport(root, archiveKind, pipelineId, md);
    io.stdout.write(`\nreport: ${reportPath}\n`);
    if (result.totalCostUsd) {
      const over = result.budgetExceeded ? ' (budget exceeded)' : '';
      io.stdout.write(
        `💰  total cost: $${result.totalCostUsd.toFixed(4)}${over}\n`,
      );
    }
  }

  return result.errors.length > 0 && result.reviews.length === 0 ? 1 : 0;
}
