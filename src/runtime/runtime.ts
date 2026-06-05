import type { Persona } from '../core/persona.ts';
import type { Provider } from '../core/provider.ts';
import type { ConsensusConfig, Pipeline, ReviewerRef } from '../core/pipeline.ts';
import type { ModelConfig } from '../core/task.ts';
import type { QuorumConfig, ReviewerConfig, PersonaConfig, PipelineConfig } from '../config/schema.ts';
import type { PluginCtx } from './plugin.ts';
import { ProviderRegistry } from '../providers/registry.ts';
import { ConsensusRegistry } from '../consensus/registry.ts';
import { InMemoryEventBus } from './bus.ts';
import { bindReviewer, type BoundReviewer } from '../reviewers/reviewer.ts';
import { openRouterFactory } from '../providers/openrouter/index.ts';
import { claudeCodeFactory } from '../providers/claude-code/index.ts';
import { codexCliFactory } from '../providers/codex-cli/index.ts';
import { continueDevFactory } from '../providers/continue-dev/index.ts';
import { cursorAgentFactory } from '../providers/cursor-agent/index.ts';
import { geminiCliFactory } from '../providers/gemini-cli/index.ts';
import { kiloCodeFactory } from '../providers/kilo-code/index.ts';
import { openCodeFactory, openCodeGoAliasFactory } from '../providers/opencode/index.ts';
import { ollamaFactory } from '../providers/ollama/index.ts';
import { overlapV1 } from '../consensus/overlap-v1.ts';
import { majorityV1 } from '../consensus/majority-v1.ts';
import { severityAwareV1 } from '../consensus/severity-aware-v1.ts';
import { semanticV2 } from '../consensus/semantic-v2.ts';
import { ConfigError } from '../core/errors.ts';
import type { EventBus } from '../core/events.ts';

export interface Runtime {
  bus: EventBus;
  providers: ProviderRegistry;
  consensus: ConsensusRegistry;
  config: QuorumConfig;
  pluginCtx: PluginCtx;
  resolveReviewer(id: string): Promise<BoundReviewer>;
  resolveReviewers(ids: string[]): Promise<BoundReviewer[]>;
  resolvePipeline(id: string): Pipeline;
  dispose(): Promise<void>;
}

export interface CreateRuntimeOptions {
  config: QuorumConfig;
  pluginCtx: PluginCtx;
  bus?: EventBus;
}

export async function createRuntime(opts: CreateRuntimeOptions): Promise<Runtime> {
  const providers = new ProviderRegistry();
  const consensus = new ConsensusRegistry();
  const bus = opts.bus ?? new InMemoryEventBus();

  providers.register(openRouterFactory);
  providers.register(claudeCodeFactory);
  providers.register(codexCliFactory);
  providers.register(continueDevFactory);
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

  const providerCache = new Map<string, Provider>();

  const resolveReviewer = async (id: string): Promise<BoundReviewer> => {
    const ref = toReviewerRef(id, opts.config.reviewers[id]);
    const persona = toPersona(ref.personaId, opts.config.personas[ref.personaId]);
    const provider = await instantiateProvider(ref.providerId, ref.providerConfig);
    return bindReviewer(ref, persona, provider);
  };

  return {
    bus,
    providers,
    consensus,
    config: opts.config,
    pluginCtx: opts.pluginCtx,
    resolveReviewer,
    async resolveReviewers(ids) {
      return Promise.all(ids.map(resolveReviewer));
    },
    resolvePipeline(id) {
      const cfg = opts.config.pipelines[id];
      if (!cfg) throw new ConfigError(`Unknown pipeline "${id}"`);
      return toPipeline(id, cfg);
    },
    async dispose() {
      for (const p of providerCache.values()) {
        if (p.dispose) await p.dispose().catch(() => undefined);
      }
      providerCache.clear();
    },
  };

  async function instantiateProvider(id: string, cfg: unknown): Promise<Provider> {
    const existing = providerCache.get(id);
    if (existing) return existing;
    const inst = await providers.instantiate(id, cfg, opts.pluginCtx);
    providerCache.set(id, inst);
    return inst;
  }
}

function toReviewerRef(id: string, cfg: ReviewerConfig | undefined): ReviewerRef {
  if (!cfg) throw new ConfigError(`Unknown reviewer "${id}"`);
  const ref: ReviewerRef = {
    id,
    personaId: cfg.persona,
    providerId: `${id}:provider`,
    providerConfig: cfg.provider,
  };
  const overrides = toModelConfig(cfg.overrides);
  if (overrides) ref.overrides = overrides;
  return ref;
}

function toPersona(id: string, cfg: PersonaConfig | undefined): Persona {
  if (!cfg) throw new ConfigError(`Unknown persona "${id}"`);
  const persona: Persona = { id, description: cfg.description, system: cfg.system };
  if (cfg.outputSchemaHint) persona.outputSchemaHint = cfg.outputSchemaHint;
  return persona;
}

function toPipeline(id: string, cfg: PipelineConfig): Pipeline {
  const pipeline: Pipeline = {
    id,
    parallel: cfg.parallel,
    reviewers: cfg.reviewers,
  };
  const consensus = toConsensusConfig(cfg.consensus);
  if (consensus) pipeline.consensus = consensus;
  if (cfg.timeoutMs) pipeline.timeoutMs = cfg.timeoutMs;
  if (cfg.maxConcurrency) pipeline.maxConcurrency = cfg.maxConcurrency;
  if (cfg.maxReviewers) pipeline.maxReviewers = cfg.maxReviewers;
  if (cfg.maxTotalCostUsd) pipeline.maxTotalCostUsd = cfg.maxTotalCostUsd;
  return pipeline;
}

function toModelConfig(cfg: ReviewerConfig['overrides']): ModelConfig | undefined {
  if (!cfg) return undefined;
  const out: ModelConfig = {};
  if (cfg.model !== undefined) out.model = cfg.model;
  if (cfg.temperature !== undefined) out.temperature = cfg.temperature;
  if (cfg.maxTokens !== undefined) out.maxTokens = cfg.maxTokens;
  if (cfg.topP !== undefined) out.topP = cfg.topP;
  return Object.keys(out).length > 0 ? out : undefined;
}

function toConsensusConfig(cfg: PipelineConfig['consensus']): ConsensusConfig | undefined {
  if (!cfg) return undefined;
  const base = cfg.requireAgreement !== undefined ? { requireAgreement: cfg.requireAgreement } : {};
  switch (cfg.strategy) {
    case 'overlap-v1':
      return { strategy: cfg.strategy, ...base };
    case 'majority-v1':
      return { strategy: cfg.strategy, ...base };
    case 'severity-aware-v1':
      return {
        strategy: cfg.strategy,
        ...base,
        ...(cfg.severityThresholds !== undefined ? { severityThresholds: cfg.severityThresholds } : {}),
      };
    case 'semantic-v2':
      return {
        strategy: cfg.strategy,
        ...base,
        ...(cfg.similarityThreshold !== undefined ? { similarityThreshold: cfg.similarityThreshold } : {}),
        ...(cfg.enableContradictions !== undefined ? { enableContradictions: cfg.enableContradictions } : {}),
        ...(cfg.metaReviewerProvider !== undefined ? { metaReviewerProvider: cfg.metaReviewerProvider } : {}),
      };
  }
}
