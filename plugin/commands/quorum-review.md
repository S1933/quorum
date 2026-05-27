---
name: quorum-review
description: Run the configured Quorum review pipeline against the current diff and render the consensus report.
argument-hint: "[pipeline-id] [--base <ref>]"
allowed-tools: Bash(git rev-parse:*), Bash(command -v:*), Bash(test:*), Bash(bun run:*), Bash(quorum review:*), Bash(cat:*)
---

Run the Quorum CLI against the user's current project configuration.

Raw arguments: `$ARGUMENTS`

Steps:
1. Resolve the target project root with `git rev-parse --show-toplevel`.
2. Keep the command working directory on that target root; do not `cd` into the Quorum plugin repo.
3. Parse the raw arguments into an argv list before running Bash:
   - Supported forms: optional pipeline id, `--pipeline <id>`, `--base <ref>`, `--format text|json`, `--json`, `--no-color`, `--no-preview`, `--report <path>`.
   - Reject any argument containing shell control or expansion characters: `` ` ``, `$`, `;`, `|`, `&`, `<`, `>`, `(`, `)`, newline, carriage return.
   - Reject quotes and backslashes in argument values; ask the user to rerun with a simpler value.
   - Do not pass raw `$ARGUMENTS` through Bash, `eval`, `sh -c`, command substitution, or an unquoted variable.
4. Resolve the Quorum CLI in this order:
   - If `QUORUM_CLI` is set, use it.
   - Else if `quorum` is on `PATH`, use `quorum`.
   - Else if `../quorum/src/cli/index.ts` exists from the target root, use that path.
   - Else fail with a clear message asking the user to set `QUORUM_CLI=/absolute/path/to/quorum/src/cli/index.ts`.
5. Invoke with each argv token shell-quoted individually. The safe shape is:
   - `bun run "$QUORUM_CLI" review '<arg1>' '<arg2>' --config "$TARGET_ROOT/quorum.yaml"` when using a `.ts` CLI path.
   - `quorum review '<arg1>' '<arg2>' --config "$TARGET_ROOT/quorum.yaml"` when using the installed binary.
   - Omit the quoted argument placeholders when there are no parsed args.
6. Run the CLI in a single Bash command so stdout/stderr are captured together.
7. Do not summarize, classify, rewrite, or paraphrase the findings.
8. Final response format:
   - First, a fenced `text` block containing the exact CLI stdout/stderr.
   - Then, if `.quorum/last-review.md` exists, a `## Report` heading followed by the exact report markdown.
   - No extra success banner, no "Summary", no rewritten "Critical issues" section.

Failure modes to surface:
- Missing `quorum.yaml`: tell the user where to put it, point at `quorum.yaml.example`.
- Missing env vars (e.g. `OPENROUTER_API_KEY`): cite the variable name and the provider that needs it.
- Empty diff: report that there is nothing to review against the chosen base ref.
- Missing Quorum CLI: ask the user to export `QUORUM_CLI` or install/link the `quorum` binary.
- Rejected arguments: explain which argument is unsupported and do not run Bash.

This command is a thin shell. All domain logic lives in `src/`.
