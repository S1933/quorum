import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('report-check', () => {
  test('escapes GitHub workflow command annotations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'quorum-report-check-'));
    dirs.push(dir);
    const reportPath = join(dir, 'report.json');
    const commentPath = join(dir, 'comment.md');
    await Bun.write(reportPath, JSON.stringify(report()));

    const proc = Bun.spawn({
      cmd: ['bun', 'run', 'src/ci/report-check.ts', reportPath, '--fail-on', 'high'],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        QUORUM_COMMENT_FILE: commentPath,
      },
    });

    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stderr).toBe('');
    expect(code).toBe(1);
    expect(stdout).toContain(
      '::error file=src/a%2Cb%3Ac%25.ts,line=7,title=🔥 bad%2C title%3A 100%25%0Anext::',
    );
    expect(stdout).toContain('correctness · first%25 line%0D%0Asecond: value, more');
  });
});

function report() {
  return {
    schemaVersion: 1,
    pipeline: {
      id: 'test',
      durationMs: 1,
      reviewCount: 1,
      errorCount: 0,
    },
    reviews: [
      {
        taskId: 'task',
        reviewerId: 'reviewer',
        durationMs: 1,
        findings: [
          {
            file: 'src/a,b:c%.ts',
            lineRange: { start: 7, end: 7 },
            severity: 'high',
            category: 'correctness',
            title: 'bad, title: 100%\nnext',
            body: 'first% line\r\nsecond: value, more',
            reviewer: 'reviewer',
          },
        ],
      },
    ],
    consensus: {
      strategyId: 'none',
      groups: [],
      unique: [
        {
          file: 'src/a,b:c%.ts',
          lineRange: { start: 7, end: 7 },
          severity: 'high',
          category: 'correctness',
          title: 'bad, title: 100%\nnext',
          body: 'first% line\r\nsecond: value, more',
          reviewer: 'reviewer',
        },
      ],
      contradictions: [],
    },
    errors: [],
  };
}
