export type ModelTier = 'small' | 'large';

export type ModelProvider = 'anthropic' | 'azure';

export interface ModelChoice {
  provider: ModelProvider;
  /** Anthropic model id, or Azure deployment name. */
  id: string;
}

export const DEFAULT_ANTHROPIC_MODELS: Record<ModelTier, ModelChoice> = {
  small: { provider: 'anthropic', id: 'claude-haiku-4-5-20251001' },
  large: { provider: 'anthropic', id: 'claude-opus-4-8' },
};

// Back-compat alias; Anthropic is the default provider.
export const DEFAULT_MODELS = DEFAULT_ANTHROPIC_MODELS;
