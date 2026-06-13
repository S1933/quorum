# Consensus

Findings are grouped when they share the same file, line range (±2 lines), and category.

Categories: `security`, `performance`, `architecture`, `correctness`, `style`.

Groups reaching the promotion threshold get an **agreement badge**; others are reported individually.

## Strategies

Selected per pipeline via `consensus: { strategy: <id> }`:

| Strategy | Rule | Threshold |
|---|---|---|
| `overlap-v1` | Absolute | ≥ `requireAgreement` (default 2) |
| `majority-v1` | Strict majority | > n/2, min 2 |
| `severity-aware-v1` | Severity-scaled | crit/high→1, med→2, low/info→3 |

### Example — 3 reviewers, `requireAgreement: 2`

```
Finding           A   B   C   overlap-v1      majority-v1     severity-aware-v1
auth:42 (crit)    ✓   ✓   ·   promoted        promoted        promoted (≥1)
auth:45 (med)     ·   ✓   ✓   —               promoted        promoted (≥2)
db:10 (low)       ✓   ·   ·   —               —               — (needs ≥3)
```

## Semantic consensus (`semantic-v2`)

Text-similarity grouping with optional contradiction detection. Configured via:

```yaml
consensus:
  strategy: semantic-v2
  similarityThreshold: 0.78
  enableContradictions: true
```

## Architecture

See [Architecture](../ARCHITECTURE.md#8-consensus-engine) for the consensus engine internals, `ConsensusStrategy` interface, and `ConsensusResult` types.
