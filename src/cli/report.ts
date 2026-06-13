import { mkdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { ConfigError } from '../core/errors.ts';
import type { CliDeps } from './types.ts';

export async function writeReport(
  path: string,
  content: string,
): Promise<void> {
  const dir = dirname(resolve(path));
  await mkdir(dir, { recursive: true });
  await Bun.write(path, content);
}

export function archiveReportPath(
  root: string,
  kind: string,
  pipelineId: string,
): string {
  const ts = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
  const safeKind = kind.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeId = pipelineId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${root}/.quorum/reviews/${safeId}/${stamp}-${safeKind}-${safeId}.md`;
}

export async function writeArchivedReport(
  root: string,
  kind: string,
  pipelineId: string,
  content: string,
): Promise<void> {
  try {
    const path = archiveReportPath(root, kind, pipelineId);
    await writeReport(path, content);
  } catch {
    /* archive is best-effort */
  }
}

export function resolveConfigPath(
  root: string,
  value: string | boolean | undefined,
  deps: CliDeps,
): string {
  const path = typeof value === 'string' ? value : deps.findConfigPath(root);
  return resolve(root, path);
}

export function assertPathInside(root: string, path: string): void {
  const rel = relative(resolve(root), resolve(path));
  if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) return;
  throw new ConfigError(`Refusing to write report outside repository: ${path}`);
}
