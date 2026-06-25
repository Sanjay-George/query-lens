export type ModelTier = 'small' | 'large';

export interface ModelChoice {
  provider: 'anthropic';
  id: string;
}

export const DEFAULT_MODELS: Record<ModelTier, ModelChoice> = {
  small: { provider: 'anthropic', id: 'claude-haiku-4-5-20251001' },
  large: { provider: 'anthropic', id: 'claude-opus-4-8' },
};
