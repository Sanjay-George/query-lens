import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
import type { Dialect } from './types.js';

const DialectSchema = z.enum(['postgres', 'mysql', 'sqlserver']);

const DbTargetSchema = z.object({
  dialect: DialectSchema,
  url: z.string().min(1),
});

const ThresholdsSchema = z.object({
  slowQueryMs: z.number().int().positive().default(200),
  largeTableRows: z.number().int().positive().default(10_000),
  maxQueriesPerPr: z.number().int().positive().default(20),
  minExtractorConfidence: z.number().min(0).max(1).default(0.7),
});

const ConfigSchema = z.object({
  db: DbTargetSchema,
  thresholds: ThresholdsSchema.default({}),
  ignore: z.array(z.string()).default([]),
});

export type Config = z.infer<typeof ConfigSchema>;
export type DbTarget = z.infer<typeof DbTargetSchema>;
export type Thresholds = z.infer<typeof ThresholdsSchema>;

export const DEFAULT_CONFIG_PATH = '.query-reviewer.yml';

export async function loadConfig(
  path: string = DEFAULT_CONFIG_PATH,
  cwd: string = process.cwd(),
): Promise<Config> {
  const absolute = resolve(cwd, path);
  if (!existsSync(absolute)) {
    throw new Error(`Config file not found at ${absolute}`);
  }
  const raw = await readFile(absolute, 'utf8');
  const parsed = parseYaml(raw);
  return ConfigSchema.parse(parsed);
}

export function dialectFromUrl(url: string): Dialect | null {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return 'postgres';
  if (url.startsWith('mysql://')) return 'mysql';
  if (url.startsWith('mssql://') || url.startsWith('sqlserver://')) return 'sqlserver';
  return null;
}
