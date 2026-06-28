#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import chalk from 'chalk';
import { reviewBaseline, type FileReview } from './reviewer.js';
import type { Finding } from './schema.js';

const program = new Command();

program
  .name('baseline-reviewer')
  .description(
    'Baseline AI-only query reviewer. Reads a unified diff, asks an LLM to flag potential ' +
      'query-performance issues, and prints inline-style comments to stdout. No database.',
  )
  .requiredOption('-d, --diff <path>', 'path to a unified diff file (e.g. `git diff main > x.diff`)')
  .option('-p, --provider <name>', 'LLM provider: anthropic | azure (default: anthropic)', 'anthropic')
  .option(
    '-m, --model <id>',
    'Anthropic model id, or Azure deployment name. Anthropic defaults to claude-opus-4-8; Azure has no default.',
  )
  .option('--azure-resource <name>', 'Azure resource name (required when --provider=azure)')
  .option('--max-files <n>', 'review at most N files (default: all)', (v) => parseInt(v, 10))
  .option('--json', 'emit JSON instead of pretty console output', false)
  .action(
    async (opts: {
      diff: string;
      provider: string;
      model?: string;
      azureResource?: string;
      maxFiles?: number;
      json: boolean;
    }) => {
      if (opts.provider !== 'anthropic' && opts.provider !== 'azure') {
        throw new Error(`--provider must be "anthropic" or "azure", got "${opts.provider}"`);
      }
      const diffText = await readFile(opts.diff, 'utf8');
      const reviews = await reviewBaseline(diffText, {
        provider: opts.provider,
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        ...(opts.azureResource !== undefined ? { azureResourceName: opts.azureResource } : {}),
        ...(opts.maxFiles !== undefined ? { maxFiles: opts.maxFiles } : {}),
        ...(opts.json
          ? {}
          : {
              onProgress: (file, findings) =>
                printFile(file.newPath ?? file.oldPath ?? '<unknown>', findings),
            }),
      });

      if (opts.json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(toJson(reviews), null, 2));
        return;
      }
      printSummary(reviews);
    },
  );

function printFile(path: string, findings: Finding[]): void {
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(chalk.bold.cyan(path));
  if (findings.length === 0) {
    // eslint-disable-next-line no-console
    console.log(chalk.dim('  (no issues found)'));
    return;
  }
  for (const f of findings) {
    const sev = severityChip(f.severity);
    // eslint-disable-next-line no-console
    console.log(`  ${chalk.dim(`L${f.line}`)} ${sev} ${chalk.bold(f.title)}`);
    for (const line of f.comment.split('\n')) {
      // eslint-disable-next-line no-console
      console.log(`      ${line}`);
    }
  }
}

function printSummary(reviews: FileReview[]): void {
  const total = reviews.reduce((n, r) => n + r.findings.length, 0);
  const errored = reviews.filter((r) => r.error);
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(
    chalk.bold(
      `Reviewed ${reviews.length} file(s), found ${total} potential issue(s).`,
    ),
  );
  if (errored.length > 0) {
    // eslint-disable-next-line no-console
    console.log(chalk.yellow(`  ${errored.length} file(s) failed to review:`));
    for (const r of errored) {
      // eslint-disable-next-line no-console
      console.log(chalk.yellow(`    - ${r.file.newPath ?? r.file.oldPath}: ${r.error}`));
    }
  }
}

function severityChip(sev: Finding['severity']): string {
  switch (sev) {
    case 'critical':
      return chalk.bgRed.white(' CRITICAL ');
    case 'high':
      return chalk.bgRed.white(' HIGH ');
    case 'medium':
      return chalk.bgYellow.black(' MEDIUM ');
    case 'low':
      return chalk.bgBlue.white(' LOW ');
    case 'nit':
      return chalk.bgGray.white(' NIT ');
  }
}

function toJson(reviews: FileReview[]) {
  return reviews.map((r) => ({
    file: r.file.newPath ?? r.file.oldPath,
    error: r.error,
    findings: r.findings,
  }));
}

program.parseAsync(process.argv).catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
