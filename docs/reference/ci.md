# CI Integration

Add the Quorum GitHub Action to your workflows to review every PR.

## 1. Add a `ci` pipeline to `quorum.yaml`

CI pipelines must use API-based providers (OpenRouter). Subprocess CLIs (`claude-code`, `gemini-cli`, etc.) are not available in GitHub Actions runners.

```yaml
reviewers:
  ci-security:
    persona: security
    provider:
      type: openrouter
      model: anthropic/claude-sonnet-4
      api_key: env:OPENROUTER_API_KEY
  ci-backend:
    persona: backend-senior
    provider:
      type: openrouter
      model: anthropic/claude-sonnet-4
      api_key: env:OPENROUTER_API_KEY

pipelines:
  ci:
    parallel: true
    reviewers:
      - ci-security
      - ci-backend
    consensus:
      strategy: severity-aware-v1
```

## 2. Add `OPENROUTER_API_KEY` to your repository secrets

In **Settings > Secrets and variables > Actions**, add `OPENROUTER_API_KEY`.

## 3. Add the workflow

```yaml
# .github/workflows/quorum-review.yml
name: Quorum Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # required for git diff base detection

      - uses: s1933/quorum@v1
        with:
          fail_on: high
          openrouter_api_key: ${{ secrets.OPENROUTER_API_KEY }}
```

## Action inputs

| Input | Default | Description |
|-------|---------|-------------|
| `pipeline` | `ci` | Pipeline ID in `quorum.yaml` |
| `config` | `quorum.yaml` | Path to config file |
| `fail_on` | `critical` | Minimum severity to fail the check (`critical`, `high`, `medium`, `never`) |
| `max_diff_bytes` | `200000` | Clip diff to byte budget |
| `openrouter_api_key` | | OpenRouter API key (required) |

## PR comment

The action posts a single PR comment (updated on each push) with a severity summary and detailed findings. Critical and high findings are expanded by default.

## Fork PRs

GitHub does not pass secrets to fork PRs. The action posts a skip notice instead of failing.
