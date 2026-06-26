import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';

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
  rowsFilteredRatio: z.number().min(0).max(1).default(0.9),
});

const LlmModelsSchema = z.object({
  small: z.string().min(1),
  large: z.string().min(1),
});

const LlmConfigSchema = z
  .object({
    provider: z.enum(['anthropic', 'azure']).default('anthropic'),
    resourceName: z.string().min(1).optional(),
    models: LlmModelsSchema.partial().optional(),
  })
  .superRefine((cfg, ctx) => {
    // Azure-specific validation: if provider is azure, resourceName and models must be provided
    if (cfg.provider !== 'azure') return;
    if (!cfg.resourceName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'llm.resourceName is required when provider is "azure"',
        path: ['resourceName'],
      });
    }
    if (!cfg.models?.small || !cfg.models?.large) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'llm.models.small and llm.models.large (Azure deployment names) are required when provider is "azure"',
        path: ['models'],
      });
    }
  });

const ConfigSchema = z.object({
  db: DbTargetSchema,
  thresholds: ThresholdsSchema.default({}),
  llm: LlmConfigSchema.default({}),
  ignore: z.array(z.string()).default([]),
});

export type Config = z.infer<typeof ConfigSchema>;
export type DbTarget = z.infer<typeof DbTargetSchema>;
export type Thresholds = z.infer<typeof ThresholdsSchema>;
export type LlmConfig = z.infer<typeof LlmConfigSchema>;

export const DEFAULT_CONFIG_PATH = '.query-lens.yml';

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
