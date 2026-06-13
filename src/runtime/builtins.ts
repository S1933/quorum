import { majorityV1 } from '../consensus/majority-v1.ts';
import { overlapV1 } from '../consensus/overlap-v1.ts';
import { semanticV2 } from '../consensus/semantic-v2.ts';
import { severityAwareV1 } from '../consensus/severity-aware-v1.ts';
import { claudeCodeFactory } from '../providers/claude-code/index.ts';
import { codexCliFactory } from '../providers/codex-cli/index.ts';
import { cursorAgentFactory } from '../providers/cursor-agent/index.ts';
import { geminiCliFactory } from '../providers/gemini-cli/index.ts';
import { kiloCodeFactory } from '../providers/kilo-code/index.ts';
import { ollamaFactory } from '../providers/ollama/index.ts';
import {
  openCodeFactory,
  openCodeGoAliasFactory,
} from '../providers/opencode/index.ts';
import { openRouterFactory } from '../providers/openrouter/index.ts';
import { ConsensusRegistry } from '../consensus/registry.ts';
import { ProviderRegistry } from '../providers/registry.ts';

export function registerBuiltins(
  providers: ProviderRegistry,
  consensus: ConsensusRegistry,
): void {
  providers.register(openRouterFactory);
  providers.register(claudeCodeFactory);
  providers.register(codexCliFactory);
  providers.register(cursorAgentFactory);
  providers.register(geminiCliFactory);
  providers.register(kiloCodeFactory);
  providers.register(openCodeFactory);
  providers.register(openCodeGoAliasFactory);
  providers.register(ollamaFactory);
  consensus.register(overlapV1);
  consensus.register(majorityV1);
  consensus.register(severityAwareV1);
  consensus.register(semanticV2);
}
