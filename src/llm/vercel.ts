import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LlmClient, GenerateOptions } from './client.js';
import { DEFAULT_MODELS, type ModelChoice, type ModelTier } from './models.js';

export interface VercelLlmClientOptions {
  apiKey?: string;
  models?: Partial<Record<ModelTier, ModelChoice>>;
}

export class VercelLlmClient implements LlmClient {
  private readonly anthropic: ReturnType<typeof createAnthropic>;
  private readonly models: Record<ModelTier, ModelChoice>;

  constructor(opts: VercelLlmClientOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not set');
    }
    this.anthropic = createAnthropic({ apiKey });
    this.models = { ...DEFAULT_MODELS, ...opts.models };
  }

  modelFor(tier: ModelTier): ModelChoice {
    return this.models[tier];
  }

  async generate<T>(opts: GenerateOptions<T>): Promise<T> {
    const model = this.modelFor(opts.tier);
    const result = await generateObject<T>({
      model: this.anthropic(model.id),
      schema: opts.schema,
      ...(opts.system !== undefined ? { system: opts.system } : {}),
      prompt: opts.prompt,
      maxTokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0,
    });
    return result.object;
  }
}
