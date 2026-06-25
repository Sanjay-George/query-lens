import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import type { LlmConfig } from '../config.js';
import type { LlmClient } from './client.js';
import { DEFAULT_ANTHROPIC_MODELS, type ModelChoice, type ModelTier } from './models.js';
import { VercelLlmClient } from './vercel.js';

// Picks the LlmClient implementation at runtime from config. Provider impls are
// all Vercel-SDK-backed (DECISIONS §7); only the model factory + model map differ.
export function createLlmClient(llm: LlmConfig): LlmClient {
  switch (llm.provider) {
    case 'anthropic':
      return buildAnthropic(llm);
    case 'azure':
      return buildAzure(llm);
  }
}

function buildAnthropic(llm: LlmConfig): LlmClient {
  const apiKey = requireEnv('ANTHROPIC_API_KEY');
  const provider = createAnthropic({ apiKey });
  const models: Record<ModelTier, ModelChoice> = {
    small: { provider: 'anthropic', id: llm.models?.small ?? DEFAULT_ANTHROPIC_MODELS.small.id },
    large: { provider: 'anthropic', id: llm.models?.large ?? DEFAULT_ANTHROPIC_MODELS.large.id },
  };
  return new VercelLlmClient((id) => provider(id), models);
}

function buildAzure(llm: LlmConfig): LlmClient {
  const apiKey = requireEnv('AZURE_API_KEY');
  // The Zod schema guarantees these are present for the azure provider.
  if (!llm.resourceName || !llm.models?.small || !llm.models?.large) {
    throw new Error('azure provider requires llm.resourceName and llm.models.{small,large}');
  }
  const provider = createAzure({ resourceName: llm.resourceName, apiKey });
  const models: Record<ModelTier, ModelChoice> = {
    small: { provider: 'azure', id: llm.models.small },
    large: { provider: 'azure', id: llm.models.large },
  };
  return new VercelLlmClient((id) => provider(id), models);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} not set`);
  return value;
}
