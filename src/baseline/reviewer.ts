import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { generateObject, type LanguageModelV1 } from 'ai';
import { parseUnifiedDiff, type DiffFile } from '../diff/reader.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import { ReviewSchema, type Finding } from './schema.js';

export type BaselineProvider = 'anthropic' | 'azure';

export interface BaselineOptions {
  /** Provider to use. Defaults to anthropic. */
  provider?: BaselineProvider;
  /**
   * Model id (Anthropic) or deployment name (Azure).
   * Anthropic defaults to `claude-opus-4-8`. Azure has no default — deployment
   * names are account-specific.
   */
  model?: string;
  /** Azure resource name (the `<name>` in https://<name>.openai.azure.com). Required for Azure. */
  azureResourceName?: string;
  /** Override the API key (defaults to ANTHROPIC_API_KEY / AZURE_API_KEY). */
  apiKey?: string;
  /** Max files to review in one run. Stops the LLM bill from running away on huge PRs. */
  maxFiles?: number;
  /** Called after each file completes; useful for CLI progress output. */
  onProgress?: (file: DiffFile, findings: Finding[]) => void;
}

export interface FileReview {
  file: DiffFile;
  findings: Finding[];
  /** Set when this file's review threw; the file is otherwise skipped. */
  error?: string;
}

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-2.0';

/**
 * Baseline AI-only reviewer: parse the diff, ask the LLM to review each file,
 * return structured findings. No database, no extraction stage, no judge.
 */
export async function reviewBaseline(
  diffText: string,
  opts: BaselineOptions = {},
): Promise<FileReview[]> {
  const model = buildModel(opts);

  const files = parseUnifiedDiff(diffText).filter((f) => f.hunks.length > 0);
  const slice = opts.maxFiles ? files.slice(0, opts.maxFiles) : files;

  const reviews: FileReview[] = [];
  for (const file of slice) {
    try {
      const result = await generateObject({
        model,
        schema: ReviewSchema,
        system: SYSTEM_PROMPT,
        prompt: buildUserPrompt(file),
        temperature: 0,
        maxTokens: 2048,
      });
      const findings = result.object.findings;
      reviews.push({ file, findings });
      opts.onProgress?.(file, findings);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reviews.push({ file, findings: [], error: message });
      opts.onProgress?.(file, []);
    }
  }
  return reviews;
}

function buildModel(opts: BaselineOptions): LanguageModelV1 {
  const provider = opts.provider ?? 'anthropic';
  if (provider === 'anthropic') {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    return createAnthropic({ apiKey })(opts.model ?? DEFAULT_ANTHROPIC_MODEL);
  }
  // Azure: deployment names are account-specific, so both resource and model are required.
  const apiKey = opts.apiKey ?? process.env.AZURE_API_KEY;
  if (!apiKey) throw new Error('AZURE_API_KEY is not set');
  if (!opts.azureResourceName) {
    throw new Error('azure provider requires --azure-resource <name>');
  }
  if (!opts.model) {
    throw new Error('azure provider requires --model <deployment-name>');
  }
  return createAzure({ resourceName: opts.azureResourceName, apiKey })(opts.model);
}
