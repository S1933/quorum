import type { FindingGroup } from '../core/finding.ts';
import type { ConsensusResult } from '../core/pipeline.ts';
import type { MetaReviewContext, MetaReviewFn } from './registry.ts';

type Contradiction = ConsensusResult['contradictions'][number];

const META_REVIEW_PROMPT = `Two reviewers reviewed the same code and reached different conclusions about the same area.

Finding A:
  Reviewer: {reviewerA}
  Severity: {severityA}
  Category: {categoryA}
  Title: {titleA}
  Body: {bodyA}

Finding B:
  Reviewer: {reviewerB}
  Severity: {severityB}
  Category: {categoryB}
  Title: {titleB}
  Body: {bodyB}

Analyze these findings and determine:
- Is one reviewer correct and the other mistaken?
- Are they identifying different aspects of the same issue?
- Are both partially correct?

Respond with a single JSON object — no prose, no preamble, no markdown fence:
{
  "resolution": "supports_a|supports_b|both_partial|different_concerns",
  "explanation": "One or two sentences explaining your reasoning."
}`;

export async function resolveContradictions(
  contradictions: Contradiction[],
  groups: FindingGroup[],
  metaReview: MetaReviewFn,
  ctx: MetaReviewContext,
): Promise<Contradiction[]> {
  const resolved: Contradiction[] = [];

  for (const c of contradictions) {
    const group = groups.find((g) => g.id === c.groupId);
    if (!group) {
      resolved.push(c);
      continue;
    }

    const a = group.members.find((m) => m.reviewer === c.reviewerA);
    const b = group.members.find((m) => m.reviewer === c.reviewerB);
    if (!a || !b) {
      resolved.push(c);
      continue;
    }

    const prompt = META_REVIEW_PROMPT.replace('{reviewerA}', a.reviewer)
      .replace('{severityA}', a.severity)
      .replace('{categoryA}', a.category)
      .replace('{titleA}', a.title)
      .replace('{bodyA}', a.body)
      .replace('{reviewerB}', b.reviewer)
      .replace('{severityB}', b.severity)
      .replace('{categoryB}', b.category)
      .replace('{titleB}', b.title)
      .replace('{bodyB}', b.body);

    try {
      const raw = await metaReview(prompt, ctx);
      const parsed = parseMetaReviewResponse(raw);
      resolved.push({
        groupId: c.groupId,
        reviewerA: c.reviewerA,
        reviewerB: c.reviewerB,
        note: `[Meta-review: ${parsed.resolution}] ${parsed.explanation}`,
      });
    } catch {
      resolved.push(c);
    }
  }

  return resolved;
}

function parseMetaReviewResponse(raw: string): {
  resolution: string;
  explanation: string;
} {
  const text = raw.trim();
  if (!text) throw new Error('Empty meta-review response');

  const fenceStart = text.startsWith('```');
  const fenceEnd = text.endsWith('```');
  const inner =
    fenceStart && fenceEnd
      ? text.slice(text.indexOf('\n') + 1, text.lastIndexOf('\n')).trim()
      : text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(inner);
  } catch {
    const match = /{[\s\S]*}/.exec(text);
    if (!match) throw new Error('No JSON found in meta-review response');
    parsed = JSON.parse(match[0]);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Meta-review response must be a JSON object');
  }

  const obj = parsed as { resolution?: unknown; explanation?: unknown };
  return {
    resolution: typeof obj.resolution === 'string' ? obj.resolution : 'unknown',
    explanation:
      typeof obj.explanation === 'string'
        ? obj.explanation
        : 'No explanation provided',
  };
}
