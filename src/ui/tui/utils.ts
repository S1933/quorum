import type { QuorumConfig } from '../../config/schema.ts';

export interface PipelineSummary {
  id: string;
  mode: 'parallel' | 'sequential';
  reviewerCount: number;
  reviewers: Array<{
    id: string;
    persona: string;
    provider: string;
    model?: string;
  }>;
  consensus: string | undefined;
}

export interface ReviewSummary {
  reviewerCount: number;
  findingCount: number;
  agreementCount: number;
  singleReviewerCount: number;
  errorCount: number;
  duration: string;
  severity: Record<string, number>;
}

export interface ReviewRecord {
  timestamp: Date;
  kind: string;
  pipelineId: string;
  path: string;
  summary: ReviewSummary | undefined;
  content: string | undefined;
}

export function extractPipelines(config: QuorumConfig): PipelineSummary[] {
  const pipelines: PipelineSummary[] = [];
  for (const [id, p] of Object.entries(config.pipelines)) {
    const reviewers = p.reviewers.map((rid) => {
      const r = config.reviewers[rid];
      if (!r) return { id: rid, persona: '?', provider: '?' };
      const prov = r.provider as Record<string, unknown>;
      const model = typeof prov.model === 'string' ? prov.model : undefined;
      const entry: {
        id: string;
        persona: string;
        provider: string;
        model?: string;
      } = {
        id: rid,
        persona: r.persona,
        provider: r.provider.type,
      };
      if (model) entry.model = model;
      return entry;
    });
    pipelines.push({
      id,
      mode: p.parallel ? 'parallel' : 'sequential',
      reviewerCount: p.reviewers.length,
      reviewers,
      consensus: p.consensus?.strategy,
    });
  }
  return pipelines;
}

export async function loadReviews(root: string): Promise<ReviewRecord[]> {
  const reviewsDir = `${root}/.quorum/reviews`;
  const dir = Bun.file(reviewsDir);
  const exists = await dir.exists();
  if (!exists) return [];

  const records: ReviewRecord[] = [];
  const glob = new Bun.Glob('**/*.md');

  for await (const entry of glob.scan({
    cwd: reviewsDir,
    onlyFiles: true,
    absolute: true,
  })) {
    const path = typeof entry === 'string' ? entry : '';
    if (!path) continue;
    const basename = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
    const match = basename.match(/^(\d{4}-\d{2}-\d{2})-(\d{6})-([^-]+)-(.*)$/);
    if (!match) continue;

    const datePart = match[1]!;
    const timePart = match[2]!;
    const kind = match[3]!;
    const pipelineId = match[4]!;

    const hh = timePart.slice(0, 2);
    const mm = timePart.slice(2, 4);
    const ss = timePart.slice(4, 6);
    const timestamp = new Date(`${datePart}T${hh}:${mm}:${ss}`);

    const summary = await parseReportSummary(path);
    const content = summary ? await Bun.file(path).text() : undefined;

    const record: ReviewRecord = {
      timestamp,
      kind,
      pipelineId,
      path,
      summary,
      content,
    };
    records.push(record);
  }

  records.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return records;
}

async function parseReportSummary(
  path: string,
): Promise<ReviewSummary | undefined> {
  try {
    const text = await Bun.file(path).text();
    const rc = text.match(/\*\*(\d+)\s*reviewer/);
    const fc = text.match(/\*\*(\d+)\s*finding/);
    const ac = text.match(/\*\*(\d+)\s*agreement/);
    const sc = text.match(/\*\*(\d+)\s*single-reviewer/);
    const ec = text.match(/\*\*(\d+)\s*error/);
    const dur = text.match(/\*\*([\d.]+)s\*\*/);

    const severity: Record<string, number> = {};
    const sevTable = text.match(/## 📊 Summary[\s\S]*?(?=## )/);
    if (sevTable) {
      const sevLines = sevTable[0]?.split('\n');
      for (const line of sevLines) {
        const m = line.match(/^\|\s*\S+\s+(.+?)\s+\|\s*(\d+)\s*\|$/);
        if (m) {
          const key = m[1]?.trim();
          severity[key] = parseInt(m[2]!, 10);
        }
      }
    }

    return {
      reviewerCount: rc ? parseInt(rc[1]!, 10) : 0,
      findingCount: fc ? parseInt(fc[1]!, 10) : 0,
      agreementCount: ac ? parseInt(ac[1]!, 10) : 0,
      singleReviewerCount: sc ? parseInt(sc[1]!, 10) : 0,
      errorCount: ec ? parseInt(ec[1]!, 10) : 0,
      duration: dur ? dur[1]! : '',
      severity,
    };
  } catch {
    return undefined;
  }
}
