import { SENSITIVE_FIELDS as OpenRouterSensitive } from '../providers/openrouter/schema.ts';
import { SENSITIVE_FIELDS as CursorAgentSensitive } from '../providers/cursor-agent/schema.ts';

const SENSITIVE_BY_TYPE: Record<string, Set<string>> = {
  openrouter: OpenRouterSensitive,
  'cursor-agent': CursorAgentSensitive,
};

export function getSensitiveFields(providerType: string): Set<string> | undefined {
  return SENSITIVE_BY_TYPE[providerType];
}