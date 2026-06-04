import type { Finding } from '../core/finding.ts';

export function textToBigrams(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return [];

  const words = normalized.split(' ');
  if (words.length === 1) return words;

  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]} ${words[i + 1]}`);
  }
  return bigrams;
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

export function findingSimilarity(a: Finding, b: Finding): number {
  const textA = `${a.title} ${a.body}`;
  const textB = `${b.title} ${b.body}`;
  return jaccardSimilarity(textToBigrams(textA), textToBigrams(textB));
}
