import { z } from 'zod';

const NonEmpty = z.string().min(1);
const SeveritySchema = z.enum(['info', 'low', 'medium', 'high', 'critical']);

export const PersonaConfigSchema = z.object({
  description: NonEmpty,
  system: NonEmpty,
  outputSchemaHint: z.string().optional(),
});

export const ModelConfigSchema = z
  .object({
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    topP: z.number().min(0).max(1).optional(),
  })
  .strict();

export const ProviderConfigSchema = z
  .object({
    type: NonEmpty,
  })
  .catchall(z.unknown());

export const ReviewerConfigSchema = z
  .object({
    persona: NonEmpty,
    provider: ProviderConfigSchema,
    overrides: ModelConfigSchema.optional(),
    fileExtensions: z.array(NonEmpty).optional(),
  })
  .strict();

const ConsensusBaseConfigSchema = z
  .object({
    requireAgreement: z.number().int().positive().optional(),
  })
  .strict();

const OverlapV1ConsensusConfigSchema = ConsensusBaseConfigSchema.extend({
  strategy: z.literal('overlap-v1'),
}).strict();

const MajorityV1ConsensusConfigSchema = ConsensusBaseConfigSchema.extend({
  strategy: z.literal('majority-v1'),
}).strict();

const SeverityAwareV1ConsensusConfigSchema = ConsensusBaseConfigSchema.extend({
  strategy: z.literal('severity-aware-v1'),
  severityThresholds: z
    .record(SeveritySchema, z.number().int().positive())
    .optional(),
}).strict();

const SemanticV2ConsensusConfigSchema = ConsensusBaseConfigSchema.extend({
  strategy: z.literal('semantic-v2'),
  similarityThreshold: z.number().min(0).max(1).optional(),
  enableContradictions: z.boolean().optional(),
  metaReviewerProvider: ProviderConfigSchema.optional(),
}).strict();

export const ConsensusConfigSchema = z.discriminatedUnion('strategy', [
  OverlapV1ConsensusConfigSchema,
  MajorityV1ConsensusConfigSchema,
  SeverityAwareV1ConsensusConfigSchema,
  SemanticV2ConsensusConfigSchema,
]);

export const PipelineConfigSchema = z
  .object({
    parallel: z.boolean().default(true),
    reviewers: z.array(NonEmpty).min(0),
    consensus: ConsensusConfigSchema.optional(),
    timeoutMs: z.number().int().positive().optional(),
    maxConcurrency: z.number().int().positive().optional(),
    maxReviewers: z.number().int().positive().optional(),
    maxTotalCostUsd: z.number().positive().optional(),
  })
  .strict();

export const DefaultsSchema = z
  .object({
    pipeline: NonEmpty.optional(),
    maxDiffBytes: z.number().int().positive().optional(),
    includeFiles: z.array(z.string().min(1)).optional(),
    excludeFiles: z.array(z.string().min(1)).optional(),
    maxConcurrency: z.number().int().positive().optional(),
  })
  .strict();

export const QuorumConfigSchema = z
  .object({
    version: z.literal(1),
    defaults: DefaultsSchema.optional(),
    personas: z.record(NonEmpty, PersonaConfigSchema),
    reviewers: z.record(NonEmpty, ReviewerConfigSchema),
    pipelines: z.record(NonEmpty, PipelineConfigSchema),
  })
  .strict();

export type QuorumConfig = z.infer<typeof QuorumConfigSchema>;
export type PersonaConfig = z.infer<typeof PersonaConfigSchema>;
export type ReviewerConfig = z.infer<typeof ReviewerConfigSchema>;
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
