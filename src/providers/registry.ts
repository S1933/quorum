import type { z } from 'zod';
import { resolveLazy } from '../config/interpolate.ts';
import type { MetaReviewFn } from '../consensus/registry.ts';
import { ConfigError } from '../core/errors.ts';
import type { Provider } from '../core/provider.ts';
import type { PluginCtx } from '../runtime/plugin.ts';

export interface ProviderFactory<S extends z.ZodTypeAny = z.ZodTypeAny> {
  type: string;
  schema: S;
  create(
    instanceId: string,
    config: z.infer<S>,
    ctx: PluginCtx,
  ): Promise<Provider>;
  createMetaReviewer?(
    config: z.infer<S>,
    ctx: PluginCtx,
  ): MetaReviewFn | undefined;
}

export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory<z.ZodTypeAny>>();

  register(factory: ProviderFactory<z.ZodTypeAny>): void {
    if (this.factories.has(factory.type)) {
      throw new ConfigError(
        `Provider type "${factory.type}" already registered`,
      );
    }
    this.factories.set(factory.type, factory);
  }

  resolve(type: string): ProviderFactory<z.ZodTypeAny> | undefined {
    return this.factories.get(type);
  }

  async instantiate(
    id: string,
    rawConfig: unknown,
    ctx: PluginCtx,
  ): Promise<Provider> {
    if (typeof rawConfig !== 'object' || rawConfig === null) {
      throw new ConfigError(`Provider "${id}" config must be an object`);
    }
    const { type } = rawConfig as { type?: string };
    if (typeof type !== 'string') {
      throw new ConfigError(
        `Provider "${id}" is missing required "type" field`,
      );
    }
    const factory = this.resolve(type);
    if (!factory) {
      throw new ConfigError(
        `Provider "${id}" uses unknown type "${type}". Available: ${[...this.factories.keys()].join(', ') || '(none)'}`,
      );
    }

    const resolved = resolveLazy(rawConfig);
    const parsed = factory.schema.safeParse(resolved);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('\n');
      throw new ConfigError(
        `Provider "${id}" (type ${type}) config invalid:\n${issues}`,
      );
    }
    return factory.create(id, parsed.data, ctx);
  }

  list(): string[] {
    return [...this.factories.keys()];
  }
}
