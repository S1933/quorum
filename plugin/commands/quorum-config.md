---
name: quorum-config
description: Show the loaded Quorum configuration (env vars redacted).
---

Run the Quorum CLI `config` command and print the JSON output as a fenced code block.

Steps:
1. Resolve the target project root with `git rev-parse --show-toplevel`.
2. Keep the command working directory on that target root; do not `cd` into the Quorum plugin repo.
3. Resolve the Quorum CLI in this order:
   - If `QUORUM_CLI` is set, use it.
   - Else if `quorum` is on `PATH`, use `quorum`.
   - Else if `../quorum-claude/src/cli/index.ts` exists from the target root, use that path.
   - Else fail with a clear message asking the user to set `QUORUM_CLI=/absolute/path/to/quorum-claude/src/cli/index.ts`.
4. Invoke:
   - `bun run "$QUORUM_CLI" config --config "$TARGET_ROOT/quorum.yaml"` when using a `.ts` CLI path.
   - `quorum config --config "$TARGET_ROOT/quorum.yaml"` when using the installed binary.
5. Display the output. Secrets are already redacted by the CLI.
6. If the user asks "why is X provider missing?", point at the resolved config path and the `providers:` block.
