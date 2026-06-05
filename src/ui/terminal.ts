import type { EventBus } from '../core/events.ts';
import type { Finding, Severity } from '../core/finding.ts';
import {
  buildSeverityBuckets,
  categoryIcon,
  collectPipelineFindings,
  countBySeverity,
  formatDuration,
  severityIcon,
  severityLabel,
  SEVERITY_ORDER,
} from './report-model.ts';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
};

const ANSI_SEQUENCE = /\x1B(?:\][^\x07]*(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g;
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

function severityColor(severity: Severity): keyof typeof COLORS {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'red';
    case 'medium':
      return 'yellow';
    case 'low':
      return 'cyan';
    case 'info':
      return 'gray';
  }
}

export function sanitizeTerminalText(text: string): string {
  return text.replace(ANSI_SEQUENCE, '').replace(CONTROL_CHARS, '');
}

export interface WriteStreamLike {
  write(chunk: string): unknown;
}

export interface TerminalRendererOptions {
  stream: WriteStreamLike;
  showTokens?: boolean;
  color?: boolean;
}

export class TerminalRenderer {
  private readonly stream: WriteStreamLike;
  private readonly color: boolean;
  private readonly showTokens: boolean;
  private readonly previews = new Map<string, string>();
  private readonly lastPreviewAt = new Map<string, number>();

  constructor(opts: TerminalRendererOptions) {
    this.stream = opts.stream;
    this.color = opts.color ?? true;
    this.showTokens = opts.showTokens ?? false;
  }

  attach(bus: EventBus): () => void {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      bus.on('pipeline.started', (e) => {
        this.line(`${this.c('cyan', '🧭')}  pipeline ${this.c('bold', this.safe(e.pipelineId))} · ${e.reviewers.length} reviewer(s)`);
        this.line(this.c('dim', `    ${e.reviewers.map((id) => this.safe(id)).join(', ')}`));
        this.line('');
      }),
    );
    unsubs.push(
      bus.on('reviewer.started', (e) => {
        this.line(`${this.c('dim', '  ⏳')} ${this.safe(e.reviewerId)} started`);
      }),
    );
    unsubs.push(
      bus.on('reviewer.event', (e) => {
        if (e.event.type === 'token' && this.showTokens) {
          this.renderPreview(e.reviewerId, e.event.text);
        } else if (e.event.type === 'finding') {
          this.line(`${this.c('dim', '   ·')} ${this.safe(e.reviewerId)}: ${this.severityIcon(e.event.finding.severity)} ${this.safe(e.event.finding.title)} ${this.c('dim', `(${this.safe(e.event.finding.file)}:${e.event.finding.lineRange.start})`)}`);
        } else if (e.event.type === 'log') {
          this.line(`${this.c('gray', `   [${this.safe(e.reviewerId)}]`)} ${this.safe(e.event.msg)}`);
        }
      }),
    );
    unsubs.push(
      bus.on('reviewer.finished', (e) => {
        const n = e.result.findings.length;
        this.line(`${this.c('green', '  ✅')} ${this.safe(e.reviewerId)} finished · ${n} finding${n === 1 ? '' : 's'} ${this.c('dim', `(${formatDuration(e.result.durationMs)})`)}`);
        this.line('');
      }),
    );
    unsubs.push(
      bus.on('reviewer.failed', (e) => {
        this.line(`${this.c('red', '  ❌')} ${this.safe(e.reviewerId)} failed: ${this.safe(e.error.message)}`);
        this.line('');
      }),
    );
    unsubs.push(
      bus.on('pipeline.timeout', () => {
        this.line(`${this.c('red', '⏱')}  pipeline timeout reached`);
      }),
    );
    unsubs.push(
      bus.on('pipeline.budget_exceeded', (e) => {
        this.line(`${this.c('red', '💰')}  budget exceeded: $${e.spent.toFixed(4)} / $${e.limit.toFixed(2)} — cancelling remaining reviewers`);
        this.line('');
      }),
    );
    unsubs.push(
      bus.on('pipeline.finished', (e) => {
        this.line('');
        this.renderSummary(e.result.consensus.groups, e.result.consensus.unique, e.result.errors.length);
        this.line('');
        this.line(this.c('bold', '── 🔎 Findings by priority ──'));
        this.renderConsensus(e.result.consensus.groups, e.result.consensus.unique);
        this.line('');
        this.line(this.c('dim', `pipeline ${this.safe(e.result.pipelineId)} done in ${formatDuration(e.result.durationMs)} (${e.result.reviews.length} reviews, ${e.result.errors.length} errors)`));
      }),
    );
    unsubs.push(
      bus.on('questions.collected', (e) => {
        this.line(`${this.c('cyan', '❓')}  ${e.count} question(s) from reviewers`);
        this.line('');
      }),
    );
    unsubs.push(
      bus.on('questions.waiting', () => {
        this.line(`${this.c('yellow', '💬')}  waiting for your answers…`);
        this.line('');
      }),
    );
    unsubs.push(
      bus.on('questions.answered', (e) => {
        this.line(`${this.c('green', '✅')}  ${e.count} question(s) answered`);
        this.line('');
      }),
    );

    return () => {
      for (const u of unsubs) u();
    };
  }

  private renderSummary(
    groups: Array<{ id: string; representative: Finding; members: Finding[]; reviewers: string[] }>,
    unique: Finding[],
    errors: number,
  ): void {
    const allFindings = collectPipelineFindings(groups, unique);
    const total = allFindings.length;
    const severityCounts = countBySeverity(allFindings);
    const counts = SEVERITY_ORDER
      .map((priority) => `${this.severityIcon(priority)} ${priority}:${severityCounts[priority]}`)
      .join('  ');

    this.line(this.c('bold', '── 📊 Review summary ──'));
    this.line(`   ${total} finding${total === 1 ? '' : 's'} · ${groups.length} agreement group${groups.length === 1 ? '' : 's'} · ${unique.length} single-reviewer · ${errors} error${errors === 1 ? '' : 's'}`);
    this.line(`   ${counts}`);
  }

  private renderConsensus(
    groups: Array<{ id: string; representative: Finding; members: Finding[]; reviewers: string[] }>,
    unique: Finding[],
  ): void {
    if (groups.length === 0 && unique.length === 0) {
      this.line(this.c('green', '  ✅ no findings'));
      return;
    }

    for (const bucket of buildSeverityBuckets(groups, unique)) {
      if (bucket.count === 0) continue;

      this.line('');
      this.line(this.c('bold', `${this.severityIcon(bucket.severity)} ${severityLabel(bucket.severity)} (${bucket.count})`));
      for (const g of bucket.groups) {
        const f = g.representative;
        const badge = this.c('magenta', `🤝 ${g.reviewers.length} agreed`);
        this.line(`  ${this.severityIcon(f.severity)} ${this.c('bold', this.safe(f.title))} ${badge}`);
        this.line(this.c('dim', `     ${this.safe(f.file)}:${f.lineRange.start}-${f.lineRange.end}`));
        if (f.body) this.line(`     ${this.safeBlock(f.body)}`);
        this.line('');
        this.line(this.c('dim', `     ${categoryIcon(f.category)} ${f.category}`));
        this.line(this.c('dim', `     reviewers: ${g.reviewers.map((id) => this.safe(id)).join(', ')}`));
        this.line('');
      }
      for (const f of bucket.unique) {
        this.line(`  ${this.severityIcon(f.severity)} ${this.c('bold', this.safe(f.title))}`);
        this.line(this.c('dim', `     ${this.safe(f.file)}:${f.lineRange.start}-${f.lineRange.end}`));
        if (f.body) this.line(`     ${this.safeBlock(f.body)}`);
        this.line('');
        this.line(this.c('dim', `     ${categoryIcon(f.category)} ${f.category} · ${this.safe(f.reviewer)}`));
        this.line('');
      }
    }
  }

  private severityIcon(severity: Severity): string {
    return this.c(severityColor(severity), severityIcon(severity));
  }

  private renderPreview(reviewerId: string, chunk: string): void {
    const next = `${this.previews.get(reviewerId) ?? ''}${this.safe(chunk)}`;
    this.previews.set(reviewerId, next);

    const now = Date.now();
    const last = this.lastPreviewAt.get(reviewerId) ?? 0;
    if (now - last < 500 && next.length < 240) return;
    this.lastPreviewAt.set(reviewerId, now);

    const preview = next
      .replace(/\s+/g, ' ')
      .trim()
      .slice(-220);
    if (!preview) return;
    this.line(`${this.c('gray', `   [${this.safe(reviewerId)}]`)} ${preview}`);
  }

  private safe(text: string): string {
    return sanitizeTerminalText(text);
  }

  private safeBlock(text: string): string {
    return this.safe(text).replace(/\n/g, '\n     ');
  }

  private c(name: keyof typeof COLORS, text: string): string {
    if (!this.color) return text;
    return `${COLORS[name]}${text}${COLORS.reset}`;
  }

  private line(s: string): void {
    this.stream.write(`${s}\n`);
  }
}
