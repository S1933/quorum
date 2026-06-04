# Feature Ideas

## 1. GitHub Action / CI integration

Quorum already has a CLI, JSON reports, Markdown reports, a pre-commit hook, and CI.
An official GitHub Action could run `quorum review --json` on pull requests, publish a
Markdown PR comment, and fail the check on `critical` or `high` findings.

This matches the existing V1.x direction in `docs/ARCHITECTURE.md`.

## 2. Semantic consensus / contradiction detection

Current consensus is mostly based on file path, line overlap, and category. A useful next
step would be semantic grouping of findings by title/body similarity, plus contradiction
detection between reviewers.

This could use embeddings for near-duplicate grouping and an optional meta-reviewer for
contradictions. It matches the V2 roadmap already described in the architecture notes.

## 3. Cost / budget guardrails

Quorum can run several reviewers in parallel, which is powerful but can create cost,
token, and rate-limit surprises. A budget feature could add pipeline-level limits such as
`maxCost`, `maxTokens`, `maxReviewers`, and rate-limit-aware scheduling.

The CLI could print an estimated budget before execution and stop cleanly when a configured
limit is reached.
