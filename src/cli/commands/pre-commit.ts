import { writeFile, unlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { CliDeps, CliIo } from '../types.ts';

function hookScript(pipelineId: string): string {
  return `#!/usr/bin/env bash
set -e

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

if [ "$QUORUM_BYPASS" = "1" ]; then
  exit 0
fi

CMD="quorum"
[ -f "$ROOT/src/cli/index.ts" ] && CMD="bun run $ROOT/src/cli/index.ts"

if ! command -v "$CMD" &>/dev/null && ! [ -f "$ROOT/src/cli/index.ts" ]; then
  exit 0
fi

REPORT="$ROOT/.quorum/last-review.json"
mkdir -p "$ROOT/.quorum"

OUTPUT=$($CMD review --pipeline ${shellQuote(pipelineId)} --json --config quorum.yaml --report "$REPORT" 2>&1 || true)
if [ -f "$REPORT" ]; then
  JSON_INPUT=$(cat "$REPORT")
else
  JSON_INPUT="$OUTPUT"
fi

BLOCKING=$(echo "$JSON_INPUT" | jq '
  [
    .reviews[].findings[]?,
    .consensus.unique[]?,
    .consensus.groups[].members[]?
  ]
  | unique_by([.reviewer, .file, .lineRange.start, .lineRange.end, .severity, .title])
  | map(select(.severity == "critical" or .severity == "high"))
' 2>/dev/null || echo '[]')
CRITICAL=$(echo "$BLOCKING" | jq 'length' 2>/dev/null || echo 0)

if [ "$CRITICAL" -gt 0 ]; then
  echo "Quorum found $CRITICAL high/critical findings. Set QUORUM_BYPASS=1 to bypass."
  echo
  echo "Quorum review report:"
  echo "$BLOCKING" | jq -r '
    .[]
    | "- [\(.severity)] \(.file):\(.lineRange.start)-\(.lineRange.end) \(.title)\n  reviewer: \(.reviewer)\n  category: \(.category)\n  \(.body // "")\n"
  '
  echo "Full JSON report: $REPORT"
  exit 1
fi
`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function cmdPreCommit(
  positional: string[],
  flags: Record<string, string | boolean>,
  deps: CliDeps,
  io: CliIo,
): Promise<number> {
  const action = positional[0];
  if (
    !action ||
    (action !== 'true' && action !== 'false') ||
    (flags.pipeline !== undefined && typeof flags.pipeline !== 'string') ||
    flags.pipeline === ''
  ) {
    io.stderr.write('Usage: quorum pre-commit true|false [--pipeline <id>]\n');
    return 2;
  }

  const root = await deps.inferRepoRoot();
  const hookPath = join(root, '.git', 'hooks', 'pre-commit');

  if (action === 'true') {
    const pipelineId = await resolvePipelineId(flags, deps, root);
    await writeFile(hookPath, hookScript(pipelineId), { mode: 0o755 });
    io.stdout.write(`pre-commit hook installed: ${hookPath} (pipeline: ${pipelineId})\n`);
    return 0;
  }

  try {
    await access(hookPath);
    await unlink(hookPath);
    io.stdout.write(`pre-commit hook removed: ${hookPath}\n`);
  } catch {
    io.stdout.write(`no pre-commit hook found at: ${hookPath}\n`);
  }

  return 0;
}

async function resolvePipelineId(
  flags: Record<string, string | boolean>,
  deps: CliDeps,
  root: string,
): Promise<string> {
  if (typeof flags.pipeline === 'string') return flags.pipeline;

  try {
    const config = await deps.loadConfigFromPath(deps.findConfigPath(root));
    return config.defaults?.pipeline ?? 'default';
  } catch {
    return 'default';
  }
}
