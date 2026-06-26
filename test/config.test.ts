import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('parses a minimal config and applies threshold defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qr-cfg-'));
    const path = join(dir, '.query-lens.yml');
    await writeFile(
      path,
      `db:\n  dialect: postgres\n  url: postgres://localhost/x\n`,
      'utf8',
    );
    const cfg = await loadConfig('.query-lens.yml', dir);
    expect(cfg.db.dialect).toBe('postgres');
    expect(cfg.thresholds.slowQueryMs).toBe(200);
    expect(cfg.thresholds.minExtractorConfidence).toBe(0.7);
    expect(cfg.thresholds.rowsFilteredRatio).toBe(0.9);
    expect(cfg.ignore).toEqual([]);
  });

  it('defaults the llm provider to anthropic', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qr-cfg-'));
    await writeFile(
      join(dir, '.query-lens.yml'),
      `db:\n  dialect: postgres\n  url: postgres://localhost/x\n`,
      'utf8',
    );
    const cfg = await loadConfig('.query-lens.yml', dir);
    expect(cfg.llm.provider).toBe('anthropic');
  });

  it('parses a valid azure llm config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qr-cfg-'));
    await writeFile(
      join(dir, '.query-lens.yml'),
      [
        'db:',
        '  dialect: postgres',
        '  url: postgres://localhost/x',
        'llm:',
        '  provider: azure',
        '  resourceName: my-resource',
        '  models:',
        '    small: gpt4o-mini-deploy',
        '    large: gpt4o-deploy',
        '',
      ].join('\n'),
      'utf8',
    );
    const cfg = await loadConfig('.query-lens.yml', dir);
    expect(cfg.llm.provider).toBe('azure');
    expect(cfg.llm.resourceName).toBe('my-resource');
    expect(cfg.llm.models).toEqual({ small: 'gpt4o-mini-deploy', large: 'gpt4o-deploy' });
  });

  it('rejects an azure llm config missing resourceName / deployments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qr-cfg-'));
    await writeFile(
      join(dir, '.query-lens.yml'),
      `db:\n  dialect: postgres\n  url: postgres://localhost/x\nllm:\n  provider: azure\n`,
      'utf8',
    );
    await expect(loadConfig('.query-lens.yml', dir)).rejects.toThrow();
  });

  it('rejects unknown dialects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qr-cfg-'));
    const path = join(dir, '.query-lens.yml');
    await writeFile(path, `db:\n  dialect: oracle\n  url: x\n`, 'utf8');
    await expect(loadConfig('.query-lens.yml', dir)).rejects.toThrow();
  });
});
