---
name: quorum-review
description: Run the configured Quorum review pipeline against the current diff and render the consensus report.
argument-hint: "[pipeline-id] [--base <ref>]"
---

Run the Quorum CLI against the user's current project configuration.

Arguments: `$ARGUMENTS`

Steps:
1. Resolve the target project root with `git rev-parse --show-toplevel`.
2. Keep the command working directory on that target root; do not `cd` into the Quorum plugin repo.
3. Resolve the Quorum CLI in this order:
   - If `QUORUM_CLI` is set, use it.
   - Else if `quorum` is on `PATH`, use `quorum`.
   - Else if `../quorum-claude/src/cli/index.ts` exists from the target root, use that path.
   - Else fail with a clear message asking the user to set `QUORUM_CLI=/absolute/path/to/quorum-claude/src/cli/index.ts`.
4. Invoke:
   - `bun run "$QUORUM_CLI" review $ARGUMENTS --config "$TARGET_ROOT/quorum.yaml"` when using a `.ts` CLI path.
   - `quorum review $ARGUMENTS --config "$TARGET_ROOT/quorum.yaml"` when using the installed binary.
5. Stream stdout/stderr from the CLI as it runs. Do not paraphrase - let the terminal renderer write directly.
6. When the run completes, surface the report path (`.quorum/last-review.md`).

Failure modes to surface:
- Missing `quorum.yaml`: tell the user where to put it, point at `quorum.yaml.example`.
- Missing env vars (e.g. `OPENROUTER_API_KEY`): cite the variable name and the provider that needs it.
- Empty diff: report that there is nothing to review against the chosen base ref.
- Missing Quorum CLI: ask the user to export `QUORUM_CLI` or install/link the `quorum` binary.

This command is a thin shell. All domain logic lives in `src/`.
