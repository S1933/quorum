# CLI Reference

## `quorum review`

Run a review pipeline against the current git diff.

```
quorum review [--pipeline=<id>] [flags]
```

| Flag | Description |
|------|-------------|
| `--pipeline` | Pipeline to run (overrides positional) |
| `--base` | Git ref to diff against (auto-detects `origin/main`) |
| `--format` | Output format: `text` | `json` (default: `text`) |
| `--json` | Shorthand for `--format json` |
| `--report` | Write report to file |
| `--allow-report-outside-root` | Permit `--report` paths outside the git repository |
| `--include` | Comma-separated glob patterns to include |
| `--exclude` | Comma-separated glob patterns to exclude |
| `--max-diff-bytes` | Clip diff to byte budget |
| `--no-color` / `--no-preview` | Quiet terminal output |
| `--config` | Path to `quorum.yaml` |

```bash
quorum review                                       # default pipeline
quorum review --pipeline ci                         # named pipeline
quorum review --json                                # JSON to stdout
quorum review --json --report .quorum/review.json   # JSON to file
quorum review --base origin/main                    # specific git ref
quorum review --include "src/**/*.ts"               # filter by glob
quorum review --no-preview --no-color               # quiet mode
```

Every review and plan-review run is automatically archived to `.quorum/reviews/` with a timestamped filename.

---

## `quorum plan-review`

Run a multi-reviewer pipeline against a Markdown/text plan file.

```
quorum plan-review <plan-file> [--pipeline=<id>] [flags]
```

Reports include findings plus a plan verdict: `approve`, `revise`, or `block`.

```bash
quorum plan-review docs/plan.md
quorum plan-review docs/plan.md --json
quorum plan-review docs/plan.md --report .quorum/plan-review.md
```

---

## `quorum reviewer add`

Add a reviewer to `quorum.yaml`.

```
quorum reviewer add \
  --provider=<type> \
  --persona=<name> \
  --model=<model> \
  [--variant=<variant>] \
  [flags]
```

| Flag | Description |
|------|-------------|
| `--provider` *required* | `openrouter`, `claude-code`, `codex-cli`, `cursor-agent`, `gemini-cli`, `kilo-code`, `opencode`, `ollama` |
| `--persona` *required* | Persona defined in `quorum.yaml` |
| `--model` *required* | Model for this provider |
| `--variant` | Provider-specific model variant or reasoning effort (Claude Code maps to `--effort`; OpenCode maps to `--variant`; Codex CLI maps to `model_reasoning_effort`; OpenRouter maps to `reasoning.effort`) |
| `--id` | Custom reviewer ID (default: `<name>-<persona>-<provider>`) |
| `--ext`, `--fileExtensions` | File extension filter, comma-separated (e.g. `ts,tsx`) |
| `--temperature` | Reviewer model temperature override, from `0` to `2` |
| `--pipeline` | Target pipeline (default: `defaults.pipeline`, then `default`) |
| `--config` | Path to `quorum.yaml` (default: `./quorum.yaml`) |

### Examples by provider

```bash
# OpenRouter
quorum reviewer add \
  --provider=openrouter \
  --persona=security \
  --model=anthropic/claude-sonnet-4 \
  --variant=high

# Claude Code
quorum reviewer add \
  --provider=claude-code \
  --persona=security \
  --model=sonnet \
  --variant=high

# Codex CLI
quorum reviewer add \
  --provider=codex-cli \
  --persona=security \
  --model=gpt-5-codex \
  --variant=high

# Cursor Agent CLI
quorum reviewer add \
  --provider=cursor-agent \
  --persona=security \
  --model=composer-2.5-fast

# Gemini CLI
quorum reviewer add \
  --provider=gemini-cli \
  --persona=security \
  --model=gemini-2.5-pro

# Kilo Code CLI
quorum reviewer add \
  --provider=kilo-code \
  --persona=security \
  --model=anthropic/claude-sonnet-4

# OpenCode
quorum reviewer add \
  --provider=opencode \
  --persona=security \
  --model=opencode-go/deepseek-v4-pro \
  --variant=high

# Ollama
quorum reviewer add \
  --provider=ollama \
  --persona=security \
  --model=qwen2.5-coder
```

### Advanced example

```bash
quorum reviewer add \
  --provider=claude-code \
  --persona=backend-senior \
  --model=sonnet \
  --fileExtensions=go \
  --temperature=0.2 \
  --id=backend-go-reviewer \
  --pipeline=default
```

---

## `quorum dashboard`

Launch a terminal TUI to browse configured pipelines and review history.

```
quorum dashboard [--config=<path>]
```

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate list |
| `←` / `→` or `Tab` | Switch between Pipelines & Reviews tabs |
| `Enter` | Expand pipeline reviewers / open full review |
| `Esc` | Go back / exit |
| `q` | Quit |

- **Pipelines tab** — lists all pipelines from `quorum.yaml` with mode, reviewer count, and consensus strategy. Press `Enter` to expand inline reviewer details (persona, provider, model).
- **Reviews tab** — shows archived reports from `.quorum/reviews/` with timestamp, pipeline, finding count, severity breakdown, and duration. Press `Enter` to read the full report.

---

## `quorum help`

Print usage information.

---

## Prompt examples

Use these prompts with a coding agent in a project that has Quorum installed. Prompts mentioning "Quorum review" are handled by the bundled `skills/review/SKILL.md` wrapper.

### Create a reviewer

Prompt:

```text
Create a Quorum reviewer named architect-minimax using the architecture persona,
the opencode provider, and model opencode-go/minimax-m3.
```

Equivalent command:

```bash
quorum reviewer add \
  --id=architect-minimax \
  --persona=architecture \
  --provider=opencode \
  --model=opencode-go/minimax-m3
```

Expected result in `quorum.yaml`:

```yaml
reviewers:
  architect-minimax:
    persona: architecture
    provider:
      type: opencode
      model: opencode-go/minimax-m3

pipelines:
  default:
    reviewers:
      - architect-minimax
```

### Run Quorum review

Prompts:

```text
Run Quorum review on the current git diff.
Run Quorum review with --pipeline ci.
Run Quorum review against origin/main and write the report to .quorum/review.md.
Run Quorum review as JSON with --report .quorum/review.json.
Run Quorum review only for src/**/*.ts.
```

Equivalent commands:

```bash
quorum review
quorum review --pipeline ci
quorum review --base origin/main --report .quorum/review.md
quorum review --json --report .quorum/review.json
quorum review --include "src/**/*.ts"
```
