import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GenerateOptions, LlmClient } from './client.js';
import type { ModelChoice, ModelTier } from './models.js';
import { DEFAULT_MODELS } from './models.js';

// Replays recorded LLM responses keyed by a hash of the request. With
// UPDATE_FIXTURES=1 it delegates to a real client, writes the fixture, and
// returns it. A missing fixture without that env var throws — tests never call
// a live model by accident. See CLAUDE.md "Testing".
export class RecordedLlmClient implements LlmClient {
  constructor(
    private readonly fixtureDir: string,
    private readonly live?: LlmClient,
  ) {}

  modelFor(tier: ModelTier): ModelChoice {
    return DEFAULT_MODELS[tier];
  }

  async generate<T>(opts: GenerateOptions<T>): Promise<T> {
    const key = requestKey(opts);
    const path = join(this.fixtureDir, `${key}.json`);

    if (process.env.UPDATE_FIXTURES === '1') {
      if (!this.live) throw new Error('UPDATE_FIXTURES=1 but no live client provided');
      const result = await this.live.generate(opts);
      await mkdir(this.fixtureDir, { recursive: true });
      await writeFile(path, JSON.stringify(result, null, 2), 'utf8');
      return result;
    }

    if (!existsSync(path)) {
      throw new Error(
        `No recorded LLM fixture at ${path}. Re-run with UPDATE_FIXTURES=1 to record.`,
      );
    }
    return JSON.parse(await readFile(path, 'utf8')) as T;
  }
}

function requestKey<T>(opts: GenerateOptions<T>): string {
  const material = JSON.stringify({
    tier: opts.tier,
    system: opts.system ?? null,
    prompt: opts.prompt,
  });
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}
