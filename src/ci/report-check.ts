#!/usr/bin/env bun

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

interface Finding {
  file: string;
  lineRange: { start: number; end: number };
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  category: 'security' | 'performance' | 'architecture' | 'correctness' | 'style';
  title: string;
  body: string;
  reviewer: string;
}

interface JsonReport {
  schemaVersion: number;
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
    findings: Finding[];
  }>;
  consensus: {
    strategyId: string;
    groups: Array<{
      id: string;
      representative: Finding;
      members: Finding[];
      reviewers: string[];
      agreement: number;
    }>;
    unique: Finding[];
    contradictions: Array<{
      groupId: string;
      reviewerA: string;
      reviewerB: string;
      note: string;
    }>;
  };
  errors: Array<{ reviewerId: string; message: string }>;
}

interface AugmentedFinding {
  finding: Finding;
  agreement?: number;
  groupId?: string;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

const SEVERITY_ICON: Record<string, string> = {
  critical: '\u{1F6A8}',
  high: '\u{1F525}',
  medium: '\u{26A0}\u{FE0F}',
  low: '\u{1F9CA}',
  info: '\u{2139}\u{FE0F}',
};

const CATEGORY_ICON: Record<string, string> = {
  security: '\u{1F510}',
  performance: '\u{26A1}',
  architecture: '\u{1F3D7}\u{FE0F}',
  correctness: '\u{2705}',
  style: '\u{1F3A8}',
};

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

function dedupKey(f: Finding): string {
  return [f.reviewer, f.file, f.lineRange.start, f.lineRange.end, f.severity, f.title].join('\x00');
}

function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}[\]()#+\-.!~|<>])/g, '\\$1');
}

function escapeFilePath(p: string): string {
  return p.replace(/`/g, '\\`');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function severityLabel(s: string): string {
  return s[0]!.toUpperCase() + s.slice(1);
}

function collectFindings(report: JsonReport): AugmentedFinding[] {
  const seen = new Set<string>();
  const out: AugmentedFinding[] = [];

  for (const group of report.consensus.groups) {
    for (const f of group.members) {
      const k = dedupKey(f);
      seen.add(k);
      out.push({ finding: f, agreement: group.agreement, groupId: group.id });
    }
  }

  for (const review of report.reviews) {
    for (const f of review.findings) {
      const k = dedupKey(f);
      if (!seen.has(k)) {
        seen.add(k);
        out.push({ finding: f });
      }
    }
  }

  for (const f of report.consensus.unique) {
    const k = dedupKey(f);
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ finding: f });
    }
  }

  return out;
}

function emitAnnotations(findings: AugmentedFinding[], failOnRank: number): boolean {
  let blocked = false;

  for (const { finding: f } of findings) {
    const rank = SEVERITY_RANK[f.severity] ?? 0;
    const icon = SEVERITY_ICON[f.severity] ?? '';
    const catIcon = CATEGORY_ICON[f.category] ?? '';
    const title = `${icon} ${f.title}`;
    const body = `${catIcon} ${f.category} \u00B7 ${f.body.replace(/\n/g, ' ')}`;

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
  findings: AugmentedFinding[],
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
    const blockedCount = findings.filter(({ finding: f }) => (SEVERITY_RANK[f.severity] ?? 0) >= SEVERITY_RANK[failOnLabel]!).length;
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

  const counts: Record<string, number> = {};
  for (const s of SEVERITY_ORDER) counts[s] = 0;
  for (const { finding: f } of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }

  const headers = SEVERITY_ORDER.map((s) => `${SEVERITY_ICON[s]} ${severityLabel(s)}`).join(' | ');
  const divider = SEVERITY_ORDER.map(() => '---:').join(' | ');
  const row = SEVERITY_ORDER.map((s) => String(counts[s])).join(' | ');

  lines.push(`| ${headers} |`);
  lines.push(`| ${divider} |`);
  lines.push(`| ${row} |`);
  lines.push('');

  for (const severity of SEVERITY_ORDER) {
    const items = findings.filter(({ finding: f }) => f.severity === severity);
    if (items.length === 0) continue;

    const icon = SEVERITY_ICON[severity] ?? '';
    const open = severity === 'critical' || severity === 'high';
    lines.push(`### ${icon} ${severityLabel(severity)} (${items.length})`);
    lines.push('');

    for (const { finding: f, agreement } of items) {
      const openTag = open ? ' open' : '';
      const catIcon = CATEGORY_ICON[f.category] ?? '';
      const agreementText = agreement != null
        ? `\u{1F91D} ${agreement}/${reviewerCount} agreement`
        : '\u{1F464} single reviewer';
      const loc = `${escapeFilePath(f.file)}:${f.lineRange.start}-${f.lineRange.end}`;

      lines.push(`<details${openTag}><summary><strong>${escapeMd(f.title)}</strong> — \`${loc}\`</summary>`);
      lines.push('');
      lines.push(`${catIcon} ${f.category} \u00B7 ${agreementText}`);
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
const failOnRank = failOn === 'never' ? 999 : (SEVERITY_RANK[failOn] ?? 4);
const commentFile = process.env.QUORUM_COMMENT_FILE ?? '.quorum/pr-comment.md';

if (!existsSync(reportPath)) {
  writeErrorComment(commentFile, 'report file not found — review may have failed');
  process.exit(2);
}

let report: JsonReport;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch {
  writeErrorComment(commentFile, 'failed to parse review report');
  process.exit(2);
}

const findings = collectFindings(report);
const blocked = emitAnnotations(findings, failOnRank);
const comment = buildComment(report, findings, failOn, blocked);

const dir = dirname(commentFile);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
writeFileSync(commentFile, comment, 'utf8');

process.exit(blocked ? 1 : 0);
