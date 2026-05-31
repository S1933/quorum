---
name: review
description: Run the configured Quorum review pipeline against the current git diff and return exact CLI/report output. Use when the user asks for a Quorum review, consensus review, multi-reviewer review, AI reviewer quorum, or local diff review.
---

# Quorum Review

Run the Quorum CLI against the user's current project. This skill is an execution wrapper only: do not inspect the diff yourself, do not rewrite findings, and do not add review opinions outside Quorum output.

Raw arguments: `$ARGUMENTS`

## Contract

- Quorum owns diff discovery, reviewer filtering, consensus, and report rendering.
- Run from the target git root; do not `cd` into the Quorum source repo unless it is the target root.
- Treat `$ARGUMENTS` as data. Never pass it through Bash, `eval`, `sh -c`, command substitution, or an unquoted variable.
- Return exact CLI output first. Include exact report content only when a report file exists.

## Argument Parsing

Parse `$ARGUMENTS` into argv before building the command.

Supported forms:

- Optional positional `pipeline-id` (at most one).
- Value flags: `--pipeline <id>`, `--pipeline=<id>`, `--base <ref>`, `--base=<ref>`, `--config <path>`, `--config=<path>`, `--report <path>`, `--report=<path>`, `--format text|json`, `--format=text|json`, `--max-diff-bytes <n>`, `--max-diff-bytes=<n>`, `--include <glob[,glob]>`, `--include=<glob[,glob]>`, `--exclude <glob[,glob]>`, `--exclude=<glob[,glob]>`.
- Boolean flags: `--json`, `--no-color`, `--no-preview`.

Reject before running:

- Unknown flags.
- More than one positional arg.
- Missing values for value flags.
- `--format` values other than `text` or `json`.
- Non-integer or negative `--max-diff-bytes`.
- Any arg containing shell control or expansion chars: `` ` ``, `$`, `;`, `|`, `&`, `<`, `>`, `(`, `)`, newline, carriage return.
- Quotes or backslashes. Ask the user to rerun with simple unquoted values; glob values like `src/**/*.ts` do not need quotes because argv tokens are shell-quoted later.

## CLI Resolution

Resolve the command in this order:

1. If `QUORUM_CLI` is set, use it.
2. If the target root is the Quorum repo (`package.json` name is `quorum`) and `src/cli/index.ts` exists, use `$TARGET_ROOT/src/cli/index.ts`.
3. If `$TARGET_ROOT/node_modules/.bin/quorum` exists, use it.
4. If `quorum` is on `PATH`, use `quorum`.
5. If `$TARGET_ROOT/../quorum/src/cli/index.ts` exists, use that path.
6. Otherwise fail before running and ask the user to set `QUORUM_CLI=/absolute/path/to/quorum/src/cli/index.ts` or install/link the `quorum` binary.

Invocation:

- `.ts` CLI path: `bun run '<cli-path>' review ...`
- Binary path or `quorum`: `'<cli>' review ...`
- Shell-quote every argv token individually with single quotes.
- Add `--config '<target-root>/quorum.yaml'` only if the user did not pass `--config`.
- For text output, add `--no-color --no-preview` unless the user already passed those flags. Do not add them for JSON output.
- Capture stdout/stderr together with one command.

## Report Handling

- Text mode writes Markdown to `--report <path>` or `<target-root>/.quorum/last-review.md`; stdout includes `report: <path>`.
- JSON mode prints JSON to stdout. It writes JSON to `--report <path>` only when `--report` is provided.
- If the CLI exits nonzero, still read the report path when it exists.
- Resolve relative report paths from the target root.
- Never invent a report when no report file exists.

## Final Response

If the CLI ran:

1. First, a fenced `text` block containing exact combined stdout/stderr.
2. Then, if a Markdown report exists, `## Report` followed by the exact Markdown report.
3. If JSON was requested, do not parse, summarize, or reformat it; return the exact JSON already present in CLI output.

No success banner, no custom `Summary`, no rewritten findings, no severity recategorization.

If the CLI did not run because of preflight rejection, return only the blocking reason and the specific rejected arg or missing CLI/config detail.

## Failure Modes

- Not in git repo: report that Quorum review needs a git worktree.
- Missing `quorum.yaml`: say where it was expected and point to `quorum.yaml.example`.
- Missing Quorum CLI: ask for `QUORUM_CLI` or an installed/linked `quorum`.
- Rejected args: name the exact unsupported arg and do not run Bash.
- Empty diff or all files filtered out: return the exact CLI message.
- No reviewers matched changed file extensions: return the exact CLI message.
- Missing provider env var, unknown pipeline, invalid config, invalid format, or diff budget exceeded: return the exact CLI error.

All domain logic lives in `src/`; this skill only orchestrates safe CLI execution and exact output rendering.
