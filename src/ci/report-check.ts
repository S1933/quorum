#!/usr/bin/env bun

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Severity } from '../core/finding.ts';
import type { JsonReport, ReportFinding } from '../ui/report-model.ts';
import {
  categoryIcon,
  collectJsonReportFindings,
  countBySeverity,
  formatDuration,
  severityIcon,
  severityLabel,
  SEVERITY_ORDER,
  SEVERITY_RANK,
} from '../ui/report-model.ts';

function parseArgs(): { reportPath: string; failOn: string } {
  const args = process.argv.slice(2);
  let reportPath = '';
  let failOn = 'critical';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--fail-on' && i + 1 < args.length) {
      failOn = args[++i]!;
    } else if (!args[i]!.startsWith('--')) {
      reportPath = args[i]!;
    }
  }

  if (!reportPath) {
    console.error('Usage: report-check.ts <report.json> [--fail-on critical|high|medium|never]');
    process.exit(2);
  }

  return { reportPath, failOn };
}

function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}[\]()#+\-.!~|<>])/g, '\\$1');
}

function escapeFilePath(p: string): string {
  return p.replace(/`/g, '\\`');
}

function emitAnnotations(findings: ReportFinding[], failOnRank: number): boolean {
  let blocked = false;

  for (const { finding: f } of findings) {
    const rank = SEVERITY_RANK[f.severity];
    const title = `${severityIcon(f.severity)} ${f.title}`;
    const body = `${categoryIcon(f.category)} ${f.category} \u00B7 ${f.body.replace(/\n/g, ' ')}`;

    if (rank >= failOnRank) {
      console.log(`::error file=${f.file},line=${f.lineRange.start},title=${title}::${body}`);
      blocked = true;
    } else {
      console.log(`::warning file=${f.file},line=${f.lineRange.start},title=${title}::${body}`);
    }
  }

  return blocked;
}

function buildComment(
  report: JsonReport,
  findings: ReportFinding[],
  failOnLabel: string,
  blocked: boolean,
): string {
  const lines: string[] = [];
  const reviewerCount = report.pipeline.reviewCount;
  const totalCount = findings.length;

  lines.push('\x3C!-- quorum:report --\x3E');
  lines.push(`## \u{1F9ED} Quorum Review — \`${escapeFilePath(report.pipeline.id)}\``);
  lines.push('');

  if (report.errors.length > 0 && reviewerCount === 0) {
    lines.push('\u26A0\uFE0F **ERROR** — all reviewers failed');
    lines.push('');
    for (const err of report.errors) {
      lines.push(`- **${escapeMd(err.reviewerId)}**: ${escapeMd(err.message)}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`*[Quorum](https://github.com/S1933/quorum)*`);
    return lines.join('\n');
  }

  if (blocked) {
    const blockedCount = findings.filter(({ finding: f }) => SEVERITY_RANK[f.severity] >= rankForFailOn(failOnLabel)).length;
    lines.push(`\u274C **BLOCKED** — ${blockedCount} finding(s) at or above **${failOnLabel}** severity`);
  } else if (totalCount > 0) {
    lines.push('\u2705 **PASSED** — no blocking findings');
  } else {
    lines.push('\u2705 **CLEAN** — no findings');
  }
  lines.push('');

  const parts = [
    `**${reviewerCount}** reviewer${reviewerCount !== 1 ? 's' : ''}`,
    `**${totalCount}** finding${totalCount !== 1 ? 's' : ''}`,
    `**${formatDuration(report.pipeline.durationMs)}**`,
    `consensus: \`${escapeFilePath(report.consensus.strategyId)}\``,
  ];
  lines.push(parts.join(' \u00B7 '));
  lines.push('');

  if (totalCount === 0) {
    lines.push('---');
    lines.push('');
    lines.push(`*[Quorum](https://github.com/S1933/quorum)*`);
    return lines.join('\n');
  }

  const counts = countBySeverity(findings.map(({ finding }) => finding));

  const headers = SEVERITY_ORDER.map((s) => `${severityIcon(s)} ${severityLabel(s)}`).join(' | ');
  const divider = SEVERITY_ORDER.map(() => '---:').join(' | ');
  const row = SEVERITY_ORDER.map((s) => String(counts[s])).join(' | ');

  lines.push(`| ${headers} |`);
  lines.push(`| ${divider} |`);
  lines.push(`| ${row} |`);
  lines.push('');

  for (const severity of SEVERITY_ORDER) {
    const items = findings.filter(({ finding: f }) => f.severity === severity);
    if (items.length === 0) continue;

    const open = severity === 'critical' || severity === 'high';
    lines.push(`### ${severityIcon(severity)} ${severityLabel(severity)} (${items.length})`);
    lines.push('');

    for (const { finding: f, agreement } of items) {
      const openTag = open ? ' open' : '';
      const agreementText = agreement != null
        ? `\u{1F91D} ${agreement}/${reviewerCount} agreement`
        : '\u{1F464} single reviewer';
      const loc = `${escapeFilePath(f.file)}:${f.lineRange.start}-${f.lineRange.end}`;

      lines.push(`<details${openTag}><summary><strong>${escapeMd(f.title)}</strong> — \`${loc}\`</summary>`);
      lines.push('');
      lines.push(`${categoryIcon(f.category)} ${f.category} \u00B7 ${agreementText}`);
      lines.push('');
      lines.push(f.body);
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  }

  if (report.errors.length > 0) {
    lines.push('### \u26A0\uFE0F Errors');
    lines.push('');
    for (const err of report.errors) {
      lines.push(`- **${escapeMd(err.reviewerId)}**: ${escapeMd(err.message)}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`*[Quorum](https://github.com/S1933/quorum)*`);

  return lines.join('\n');
}

function writeErrorComment(commentFile: string, message: string): void {
  const body = [
    '\x3C!-- quorum:report --\x3E',
    '## \u{1F9ED} Quorum Review',
    '',
    `\u26A0\uFE0F **ERROR** — ${escapeMd(message)}`,
    '',
    '---',
    '',
    '*[Quorum](https://github.com/S1933/quorum)*',
  ].join('\n');

  const dir = dirname(commentFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(commentFile, body, 'utf8');
}

const { reportPath, failOn } = parseArgs();
const failOnRank = rankForFailOn(failOn);
const commentFile = process.env.QUORUM_COMMENT_FILE ?? '.quorum/pr-comment.md';

if (!existsSync(reportPath)) {
  writeErrorComment(commentFile, 'report file not found — review may have failed');
  process.exit(2);
}

let report: JsonReport;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8')) as JsonReport;
} catch {
  writeErrorComment(commentFile, 'failed to parse review report');
  process.exit(2);
}

const findings = collectJsonReportFindings(report);
const blocked = emitAnnotations(findings, failOnRank);
const comment = buildComment(report, findings, failOn, blocked);

const dir = dirname(commentFile);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
writeFileSync(commentFile, comment, 'utf8');

process.exit(blocked ? 1 : 0);

function rankForFailOn(label: string): number {
  if (label === 'never') return 999;
  return SEVERITY_RANK[label as Severity] ?? SEVERITY_RANK.critical;
}
