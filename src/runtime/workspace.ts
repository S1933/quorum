import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkspaceInfo } from '../core/task.ts';
import { ProviderRuntimeError, DiffBudgetError } from '../core/errors.ts';

export interface WorkspaceProbeOptions {
  root: string;
  baseRef?: string;
}

const MAX_UNTRACKED_BYTES = 24 * 1024;

export async function probeWorkspace(opts: WorkspaceProbeOptions): Promise<WorkspaceInfo> {
  const { root } = opts;
  const baseRef = opts.baseRef ?? (await defaultBaseRef(root));

  let mergeBase: string | undefined;
  if (baseRef) {
    mergeBase = await getMergeBase(root, baseRef);
  }

  const [diff, untracked, changedFiles] = await Promise.all([
    gitDiff(root, mergeBase),
    gitUntrackedInfo(root),
    gitDiffFileList(root, mergeBase),
  ]);
  const combinedDiff = [diff, untracked.diff].filter(Boolean).join('\n\n') || undefined;
  const files = [...new Set([...changedFiles, ...untracked.files])];
  const ws: WorkspaceInfo = { root, files };
  if (baseRef) ws.baseRef = baseRef;
  if (combinedDiff) ws.diff = combinedDiff;
  return ws;
}

async function defaultBaseRef(root: string): Promise<string | undefined> {
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    if (await refExists(root, candidate)) return candidate;
  }
  return undefined;
}

async function refExists(root: string, ref: string): Promise<boolean> {
  const proc = Bun.spawn({
    cmd: ['git', 'rev-parse', '--verify', '--quiet', ref],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  return code === 0;
}

interface GitOk {
  ok: true;
  out: string;
}

interface GitErr {
  ok: false;
  err: string;
}

type GitResult = GitOk | GitErr;

async function runGit(root: string, args: string[]): Promise<GitResult> {
  const proc = Bun.spawn({
    cmd: ['git', ...args],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    return { ok: false, err: err.trim() || `git ${args.join(' ')} failed with code ${code}` };
  }
  const trimmed = out.trim();
  return { ok: true, out: trimmed ? trimmed : '' };
}

async function runGitNul(root: string, args: string[]): Promise<string[]> {
  const result = await runGit(root, args);
  if (!result.ok) return [];
  if (!result.out) return [];
  return result.out.split('\0').filter(Boolean);
}

async function gitDiff(root: string, mergeBase: string | undefined): Promise<string | undefined> {
  if (mergeBase) {
    const result = await runGit(root, ['diff', mergeBase]);
    if (!result.ok) throw new ProviderRuntimeError('workspace', result.err);
    return result.out || undefined;
  }

  const chunks: string[] = [];
  const [stagedResult, worktreeResult] = await Promise.all([
    runGit(root, ['diff', '--cached']),
    runGit(root, ['diff']),
  ]);
  if (!stagedResult.ok) throw new ProviderRuntimeError('workspace', stagedResult.err);
  if (!worktreeResult.ok) throw new ProviderRuntimeError('workspace', worktreeResult.err);
  if (stagedResult.out) chunks.push(stagedResult.out);
  if (worktreeResult.out) chunks.push(worktreeResult.out);

  return chunks.length > 0 ? chunks.join('\n') : undefined;
}

async function getMergeBase(root: string, baseRef: string): Promise<string | undefined> {
  const proc = Bun.spawn({
    cmd: ['git', 'merge-base', baseRef, 'HEAD'],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? out.trim() : undefined;
}

async function gitDiffFileList(root: string, mergeBase: string | undefined): Promise<string[]> {
  if (mergeBase) {
    return runGitNul(root, ['diff', '--name-only', '-z', mergeBase]);
  }

  const results = await Promise.all([
    runGitNul(root, ['diff', '--name-only', '-z', '--cached']),
    runGitNul(root, ['diff', '--name-only', '-z']),
  ]);
  return [...new Set(results.flat())];
}

interface UntrackedInfo {
  diff?: string;
  files: string[];
}

async function gitUntrackedInfo(root: string): Promise<UntrackedInfo> {
  const files = await runGitNul(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (files.length === 0) return { files: [] };

  const chunks: string[] = [];
  for (const file of files) {
    chunks.push(await formatUntrackedFile(root, file));
  }
  const out: UntrackedInfo = { files };
  if (chunks.length > 0) out.diff = chunks.join('\n\n');
  return out;
}

async function formatUntrackedFile(root: string, file: string): Promise<string> {
  const header = [`diff --git a/${file} b/${file}`, 'new file mode 100644', '--- /dev/null', `+++ b/${file}`];
  const absolute = join(root, file);

  try {
    const info = await stat(absolute);
    if (!info.isFile()) return [...header, `@@ -0,0 +1 @@`, `+(skipped: not a regular file)`].join('\n');
    if (info.size > MAX_UNTRACKED_BYTES) {
      return [...header, '@@ -0,0 +1 @@', `+(skipped: ${info.size} bytes exceeds ${MAX_UNTRACKED_BYTES} byte limit)`].join('\n');
    }

    const data = await readFile(absolute);
    if (!isProbablyText(data)) {
      return [...header, '@@ -0,0 +1 @@', '+(skipped: binary file)'].join('\n');
    }

    const text = data.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
    const lineCount = text.length === 0 ? 0 : lines.length;
    return [...header, `@@ -0,0 +1,${lineCount} @@`, ...lines.map((line) => `+${line}`)].join('\n');
  } catch {
    return [...header, '@@ -0,0 +1 @@', '+(skipped: unreadable file)'].join('\n');
  }
}

function isProbablyText(data: Uint8Array): boolean {
  if (data.length === 0) return true;
  return !data.includes(0);
}

export interface DiffLimits {
  maxDiffBytes?: number;
  includeFiles?: string[];
  excludeFiles?: string[];
}

export function applyDiffLimits(workspace: WorkspaceInfo, limits: DiffLimits): WorkspaceInfo {
  let ws = workspace;
  if (limits.includeFiles?.length || limits.excludeFiles?.length) {
    ws = filterDiffByFiles(ws, limits.includeFiles, limits.excludeFiles);
  }
  if (limits.maxDiffBytes !== undefined && ws.diff) {
    enforceDiffBudget(ws.diff, limits.maxDiffBytes, ws.files ?? []);
  }
  return ws;
}

export function filterDiffByFiles(
  workspace: WorkspaceInfo,
  include?: string[],
  exclude?: string[],
): WorkspaceInfo {
  if (!workspace.diff) return workspace;
  if (!include?.length && !exclude?.length) return workspace;

  const sections = splitDiffSections(workspace.diff);
  const kept = sections.filter(({ file }) => {
    if (include?.length && !include.some((p) => globMatch(p, file))) return false;
    if (exclude?.length && exclude.some((p) => globMatch(p, file))) return false;
    return true;
  });

  const joined = kept.map((s) => s.raw).join('\n');
  const files = kept.map((s) => s.file);
  const { diff: _stripped, ...rest } = workspace;
  const out: WorkspaceInfo = { ...rest, files };
  if (joined) out.diff = joined;
  return out;
}

export function enforceDiffBudget(diff: string, maxBytes: number, files: string[]): void {
  const actual = Buffer.byteLength(diff, 'utf8');
  if (actual > maxBytes) {
    throw new DiffBudgetError(actual, maxBytes, files.length);
  }
}

interface DiffSection {
  file: string;
  raw: string;
}

function splitDiffSections(diff: string): DiffSection[] {
  const sections: DiffSection[] = [];
  const headerRe = /^diff --git a\/(.+) b\/(.+)$/;
  const lines = diff.split('\n');
  let current: { file: string; startIdx: number } | undefined;

  for (let i = 0; i < lines.length; i++) {
    const m = headerRe.exec(lines[i]!);
    if (m) {
      if (current) {
        sections.push({ file: current.file, raw: lines.slice(current.startIdx, i).join('\n') });
      }
      current = { file: m[2]!, startIdx: i };
    }
  }
  if (current) {
    sections.push({ file: current.file, raw: lines.slice(current.startIdx).join('\n') });
  }
  return sections;
}

export function globMatch(pattern: string, path: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(path);
}

function globToRegex(pattern: string): RegExp {
  let src = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === '*' && pattern[i + 1] === '*') {
      src += pattern[i + 2] === '/' ? '(?:.+/)?' : '.*';
      i += pattern[i + 2] === '/' ? 3 : 2;
    } else if (ch === '*') {
      src += '[^/]*';
      i++;
    } else if (ch === '?') {
      src += '[^/]';
      i++;
    } else {
      src += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(`^${src}$`);
}

export async function inferRepoRoot(start: string = process.cwd()): Promise<string> {
  const proc = Bun.spawn({
    cmd: ['git', 'rev-parse', '--show-toplevel'],
    cwd: start,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) {
    throw new ProviderRuntimeError('workspace', `Not inside a git repository (cwd=${start})`);
  }
  return out.trim();
}
