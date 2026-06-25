import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, dialectFromUrl } from '../src/config.js';

describe('loadConfig', () => {
  it('parses a minimal config and applies threshold defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qr-cfg-'));
    const path = join(dir, '.query-reviewer.yml');
    await writeFile(
      path,
      `db:\n  dialect: postgres\n  url: postgres://localhost/x\n`,
      'utf8',
    );
    const cfg = await loadConfig('.query-reviewer.yml', dir);
    expect(cfg.db.dialect).toBe('postgres');
    expect(cfg.thresholds.slowQueryMs).toBe(200);
    expect(cfg.thresholds.minExtractorConfidence).toBe(0.7);
    expect(cfg.ignore).toEqual([]);
  });

  it('rejects unknown dialects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qr-cfg-'));
    const path = join(dir, '.query-reviewer.yml');
    await writeFile(path, `db:\n  dialect: oracle\n  url: x\n`, 'utf8');
    await expect(loadConfig('.query-reviewer.yml', dir)).rejects.toThrow();
  });
});

describe('dialectFromUrl', () => {
  it.each([
    ['postgres://h/d', 'postgres'],
    ['postgresql://h/d', 'postgres'],
    ['mysql://h/d', 'mysql'],
    ['sqlserver://h/d', 'sqlserver'],
    ['mssql://h/d', 'sqlserver'],
  ] as const)('maps %s to %s', (url, expected) => {
    expect(dialectFromUrl(url)).toBe(expected);
  });

  it('returns null for unknown schemes', () => {
    expect(dialectFromUrl('redis://h')).toBeNull();
  });
});
