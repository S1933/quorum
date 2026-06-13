# JSON Report Reference

When `quorum review` or `quorum plan-review` is run with `--json`, the output is a single JSON object on stdout conforming to schema version 1.

## Schema (`schemaVersion: 1`)

| Key | Type | Description |
|-----|------|-------------|
| `schemaVersion` | `1` | Always `1` for this schema version |
| `pipeline` | `object` | Pipeline metadata |
| `reviews` | `array` | One entry per reviewer that ran |
| `consensus` | `object` | Consensus aggregation across reviews |
| `verdictSummary` | `object?` | Plan-review verdict — present only for `plan-review` |
| `errors` | `array` | Reviewer failures (empty when all succeed) |

### `pipeline`

| Key | Type | Description |
|-----|------|-------------|
| `id` | `string` | Pipeline identifier from `quorum.yaml` |
| `durationMs` | `number` | Total wall-clock milliseconds |
| `reviewCount` | `number` | Number of reviewers that ran |
| `errorCount` | `number` | Number of reviewer failures |

### `reviews[]`

| Key | Type | Description |
|-----|------|-------------|
| `taskId` | `string` | Internal task identifier |
| `reviewerId` | `string` | Reviewer identifier from `quorum.yaml` |
| `durationMs` | `number` | Milliseconds spent on this reviewer |
| `usage` | `object?` | Token usage + cost (provider-reported) |
| `verdict` | `object?` | Plan-review verdict — present only for `plan-review` |
| `findings` | `Finding[]` | Structured findings produced by this reviewer |

#### `usage`

| Key | Type | Description |
|-----|------|-------------|
| `inputTokens` | `number` | Input tokens consumed |
| `outputTokens` | `number` | Output tokens produced |
| `costUsd` | `number?` | Cost in USD (provider-reported) |

#### `verdict` (plan-review only)

| Key | Type | Description |
|-----|------|-------------|
| `decision` | `"approve" \| "revise" \| "block"` | Reviewer's plan-level decision |
| `summary` | `string` | Reviewer's plan-level summary |
| `confidence` | `"low" \| "medium" \| "high"?` | Reviewer's confidence |

### `consensus`

| Key | Type | Description |
|-----|------|-------------|
| `strategyId` | `string` | Strategy used (`overlap-v1`, `majority-v1`, `severity-aware-v1`, `semantic-v2`) |
| `groups` | `FindingGroup[]` | Findings where multiple reviewers agreed |
| `unique` | `Finding[]` | Findings raised by a single reviewer |
| `contradictions` | `Contradiction[]` | Severity/category disagreements within groups |

### `FindingGroup`

| Key | Type | Description |
|-----|------|-------------|
| `id` | `string` | Group identifier (e.g. `g1`) |
| `representative` | `Finding` | Highest-severity finding in the group |
| `members` | `Finding[]` | All findings in this group |
| `reviewers` | `string[]` | Reviewer IDs that contributed |
| `agreement` | `number` | How many reviewers agreed (same as `reviewers.length`) |

### `Finding`

| Key | Type | Description |
|-----|------|-------------|
| `file` | `string` | Relative file path |
| `lineRange` | `{ start: number; end: number }` | Line range in the file |
| `severity` | `"critical" \| "high" \| "medium" \| "low" \| "info"` | Severity level |
| `category` | `"security" \| "performance" \| "architecture" \| "correctness" \| "style"` | Finding category |
| `title` | `string` | Short description |
| `body` | `string` | Detailed explanation |
| `reviewer` | `string` | Reviewer ID that produced this finding |

### `Contradiction[]`

| Key | Type | Description |
|-----|------|-------------|
| `groupId` | `string` | Group where contradiction was detected |
| `reviewerA` | `string` | First reviewer |
| `reviewerB` | `string` | Second reviewer |
| `note` | `string` | Human-readable explanation |

### `verdictSummary` (plan-review only)

| Key | Type | Description |
|-----|------|-------------|
| `decision` | `"approve" \| "revise" \| "block"` | Aggregate decision |
| `counts.approve` | `number` | Number of reviewers that approved |
| `counts.revise` | `number` | Number of reviewers that want revisions |
| `counts.block` | `number` | Number of reviewers that blocked |
| `summaries[]` | `array` | Per-reviewer verdict details |

#### `summaries[]`

| Key | Type | Description |
|-----|------|-------------|
| `reviewerId` | `string` | Reviewer identifier |
| `decision` | `"approve" \| "revise" \| "block"` | This reviewer's decision |
| `summary` | `string` | This reviewer's plan summary |
| `confidence` | `"low" \| "medium" \| "high"?` | This reviewer's confidence |

### `errors[]`

| Key | Type | Description |
|-----|------|-------------|
| `reviewerId` | `string` | Reviewer that failed |
| `message` | `string` | Error message |

## Examples

### Diff review (`quorum review --json`)

```json
{
  "schemaVersion": 1,
  "pipeline": {
    "id": "default",
    "durationMs": 4521,
    "reviewCount": 2,
    "errorCount": 0
  },
  "reviews": [
    {
      "taskId": "review-1718380000000:sec-opus",
      "reviewerId": "sec-opus",
      "durationMs": 3200,
      "usage": {
        "inputTokens": 2400,
        "outputTokens": 180,
        "costUsd": 0.0124
      },
      "findings": [
        {
          "file": "src/auth/login.ts",
          "lineRange": { "start": 42, "end": 48 },
          "severity": "high",
          "category": "security",
          "title": "Missing input validation on user-supplied redirect URL",
          "body": "The login handler accepts a `redirect` query parameter and passes it to `res.redirect()` without validation. An attacker can craft a phishing URL.",
          "reviewer": "sec-opus"
        }
      ]
    },
    {
      "taskId": "review-1718380000000:perf-opus",
      "reviewerId": "perf-opus",
      "durationMs": 4100,
      "findings": []
    }
  ],
  "consensus": {
    "strategyId": "overlap-v1",
    "groups": [],
    "unique": [
      {
        "file": "src/auth/login.ts",
        "lineRange": { "start": 42, "end": 48 },
        "severity": "high",
        "category": "security",
        "title": "Missing input validation on user-supplied redirect URL",
        "body": "The login handler accepts a `redirect` query parameter and passes it to `res.redirect()` without validation. An attacker can craft a phishing URL.",
        "reviewer": "sec-opus"
      }
    ],
    "contradictions": []
  },
  "errors": []
}
```

### Plan review (`quorum plan-review plan.md --json`)

```json
{
  "schemaVersion": 1,
  "pipeline": {
    "id": "default",
    "durationMs": 5230,
    "reviewCount": 2,
    "errorCount": 0
  },
  "reviews": [
    {
      "taskId": "plan-review-1718380000000:arch-opus",
      "reviewerId": "arch-opus",
      "durationMs": 2800,
      "verdict": {
        "decision": "revise",
        "summary": "The API schema changes are missing a migration strategy for existing clients.",
        "confidence": "high"
      },
      "findings": [
        {
          "file": "docs/plan.md",
          "lineRange": { "start": 15, "end": 20 },
          "severity": "high",
          "category": "architecture",
          "title": "Missing migration strategy",
          "body": "The plan describes new API endpoints but does not address backward compatibility or data migration for existing clients.",
          "reviewer": "arch-opus"
        }
      ]
    }
  ],
  "verdictSummary": {
    "decision": "revise",
    "counts": { "approve": 0, "revise": 2, "block": 0 },
    "summaries": [
      {
        "reviewerId": "arch-opus",
        "decision": "revise",
        "summary": "Missing migration strategy.",
        "confidence": "high"
      },
      {
        "reviewerId": "sec-opus",
        "decision": "revise",
        "summary": "No security review of the proposed auth changes.",
        "confidence": "medium"
      }
    ]
  },
  "consensus": {
    "strategyId": "overlap-v1",
    "groups": [],
    "unique": [],
    "contradictions": []
  },
  "errors": []
}
```

## Programmatic consumption

The JSON report is designed for scripting and CI integration.

```bash
# Extract all unique findings
quorum review --json | jq '.consensus.unique[]'

# Count findings by severity
quorum review --json | jq '[.consensus.groups[].members[], .consensus.unique[]] | group_by(.severity) | map({severity: .[0].severity, count: length})'

# Total cost from all reviewers
quorum review --json | jq '[.reviews[].usage.costUsd // 0] | add'

# Check if any reviewer failed
quorum review --json | jq '.errors | length > 0'

# Extract consensus groups with agreement count
quorum review --json | jq '.consensus.groups[] | {title: .representative.title, agreement: .agreement, severity: .representative.severity}'
```

The JSON report is also consumed internally by `src/ci/report-check.ts` which parses the report, emits GitHub Actions workflow annotations (`::error` / `::warning`), and generates the PR comment body from the same schema.
