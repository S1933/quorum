import { writeFile, unlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { CliDeps, CliIo } from '../types.ts';

const HOOK_SCRIPT = `#!/usr/bin/env bash
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

OUTPUT=$($CMD review --json --config quorum.yaml 2>&1 || true)
CRITICAL=$(echo "$OUTPUT" | jq -r '.findings[] | select(.severity=="critical" or .severity=="high") | .severity' 2>/dev/null | wc -l || echo 0)

if [ "$CRITICAL" -gt 0 ]; then
  echo "Quorum found $CRITICAL high/critical findings. Set QUORUM_BYPASS=1 to bypass."
  exit 1
fi
`;

export async function cmdPreCommit(
  positional: string[],
  _flags: Record<string, string | boolean>,
  deps: CliDeps,
  io: CliIo,
): Promise<number> {
  const action = positional[0];
  if (!action || (action !== 'true' && action !== 'false')) {
    io.stderr.write('Usage: quorum pre-commit true|false\n');
    return 2;
  }

  const root = await deps.inferRepoRoot();
  const hookPath = join(root, '.git', 'hooks', 'pre-commit');

  if (action === 'true') {
    await writeFile(hookPath, HOOK_SCRIPT, { mode: 0o755 });
    io.stdout.write(`pre-commit hook installed: ${hookPath}\n`);
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