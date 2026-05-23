import { describe, expect, test } from 'bun:test';
import { ConfigError } from '../src/core/errors.ts';
import { loadConfigFromString } from '../src/config/loader.ts';

describe('loadConfigFromString', () => {
  test('rejects defaults.provider because review-only config selects pipelines', async () => {
    const source = `
version: 1
defaults:
  provider: openrouter-claude
  pipeline: default
providers:
  openrouter-claude:
    type: openrouter
    api_key: test-key
    model: test-model
personas:
  security:
    description: Security review
    system: Review security issues.
reviewers:
  sec:
    persona: security
    provider: openrouter-claude
pipelines:
  default:
    reviewers: [sec]
`;

    await expect(loadConfigFromString(source)).rejects.toThrow(ConfigError);
  });
});
