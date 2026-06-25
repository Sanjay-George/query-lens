import { generateObject, type LanguageModelV1 } from 'ai';
import type { LlmClient, GenerateOptions } from './client.js';
import type { ModelChoice, ModelTier } from './models.js';

/** Resolves a provider-specific model/deployment id to a Vercel language model. */
export type ModelFactory = (id: string) => LanguageModelV1;

// Provider-agnostic Vercel AI SDK client. The provider (Anthropic, Azure, …) is
// injected as a model factory so this structured-output logic lives in one place.
// Use `createLlmClient` (factory.ts) to build one from config.
export class VercelLlmClient implements LlmClient {
  constructor(
    private readonly modelFactory: ModelFactory,
    private readonly models: Record<ModelTier, ModelChoice>,
  ) {}

  modelFor(tier: ModelTier): ModelChoice {
    return this.models[tier];
  }

  async generate<T>(opts: GenerateOptions<T>): Promise<T> {
    const model = this.modelFor(opts.tier);
    const result = await generateObject<T>({
      model: this.modelFactory(model.id),
      schema: opts.schema,
      ...(opts.system !== undefined ? { system: opts.system } : {}),
      prompt: opts.prompt,
      maxTokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0,
    });
    return result.object;
  }
}
