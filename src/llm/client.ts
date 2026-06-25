import type { z } from 'zod';
import type { ModelChoice, ModelTier } from './models.js';

// Mirrors the schema signature used by the Vercel AI SDK's generateObject so
// that any zod schema callers construct can be passed through unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LlmSchema<T> = z.Schema<T, z.ZodTypeDef, any>;

export interface GenerateOptions<T> {
  tier: ModelTier;
  system?: string;
  prompt: string;
  schema: LlmSchema<T>;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmClient {
  generate<T>(opts: GenerateOptions<T>): Promise<T>;
  modelFor(tier: ModelTier): ModelChoice;
}
