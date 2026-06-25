import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLlmClient } from '../src/llm/factory.js';
import type { LlmConfig } from '../src/config.js';

const ANTHROPIC: LlmConfig = { provider: 'anthropic' };
const ANTHROPIC_OVERRIDE: LlmConfig = {
  provider: 'anthropic',
  models: { small: 'claude-custom-small', large: 'claude-custom-large' },
};
const AZURE: LlmConfig = {
  provider: 'azure',
  resourceName: 'my-resource',
  models: { small: 'gpt4o-mini-deploy', large: 'gpt4o-deploy' },
};

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AZURE_API_KEY;
});
afterEach(() => {
  process.env = { ...saved };
});

describe('createLlmClient', () => {
  it('builds an Anthropic client with default models', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const client = createLlmClient(ANTHROPIC);
    expect(client.modelFor('small')).toEqual({
      provider: 'anthropic',
      id: 'claude-haiku-4-5-20251001',
    });
    expect(client.modelFor('large').provider).toBe('anthropic');
  });

  it('honors Anthropic model overrides from config', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const client = createLlmClient(ANTHROPIC_OVERRIDE);
    expect(client.modelFor('small').id).toBe('claude-custom-small');
    expect(client.modelFor('large').id).toBe('claude-custom-large');
  });

  it('builds an Azure client using deployment names as model ids', () => {
    process.env.AZURE_API_KEY = 'az-test';
    const client = createLlmClient(AZURE);
    expect(client.modelFor('small')).toEqual({ provider: 'azure', id: 'gpt4o-mini-deploy' });
    expect(client.modelFor('large')).toEqual({ provider: 'azure', id: 'gpt4o-deploy' });
  });

  it('throws when the provider API key is missing', () => {
    expect(() => createLlmClient(ANTHROPIC)).toThrow('ANTHROPIC_API_KEY not set');
    expect(() => createLlmClient(AZURE)).toThrow('AZURE_API_KEY not set');
  });
});
