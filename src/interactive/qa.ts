import * as readline from 'node:readline';
import type { CliIo } from '../cli/types.ts';
import type { ReviewResult } from '../core/task.ts';
import { parseQuestions } from '../reviewers/output.ts';

export interface ReviewerQuestion {
  reviewerId: string;
  question: string;
  context?: string;
}

export function collectQuestions(reviews: ReviewResult[]): ReviewerQuestion[] {
  const out: ReviewerQuestion[] = [];
  for (const r of reviews) {
    const parsed = parseQuestions(r.rawOutput);
    for (const q of parsed) {
      out.push({
        reviewerId: r.reviewerId,
        question: q.question,
        ...(q.context !== undefined ? { context: q.context } : {}),
      });
    }
  }
  return out;
}

function wordSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = wordSet(a);
  const setB = wordSet(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

export function deduplicateQuestions(
  questions: ReviewerQuestion[],
): ReviewerQuestion[] {
  const deduped: ReviewerQuestion[] = [];
  for (const q of questions) {
    const isDuplicate = deduped.some(
      (existing) => jaccardSimilarity(q.question, existing.question) > 0.5,
    );
    if (!isDuplicate) deduped.push(q);
  }
  return deduped;
}

export async function promptQuestions(
  questions: ReviewerQuestion[],
  io: CliIo,
): Promise<Map<string, string>> {
  const answers = new Map<string, string>();

  if (!io.stdin?.isTTY) {
    throw new Error(
      'No TTY available — cannot answer questions interactively. Use a terminal or run without --interactive.',
    );
  }

  const stdout = io.stdout as unknown as NodeJS.WriteStream;
  stdout.write('\n');
  stdout.write('── ❓ Reviewer Questions ──\n');

  const rl = readline.createInterface({
    input: io.stdin,
    output: stdout,
  });

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const label = `  ${i + 1}. [${q.reviewerId}] ${q.question}`;
    stdout.write(`\n${label}`);
    if (q.context) stdout.write(`\n     Context: ${q.context}`);
    stdout.write('\n');

    const answer = await new Promise<string>((resolve) => {
      rl.question('     > ', resolve);
    });

    answers.set(q.question, answer.trim() || '(no answer provided)');
  }

  rl.close();
  stdout.write('\n');
  return answers;
}
