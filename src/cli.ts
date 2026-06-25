#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { loadConfig, DEFAULT_CONFIG_PATH } from './config.js';
import { createLlmClient } from './llm/factory.js';
import { PostgresAdapter } from './db/postgres.js';
import { ContextResolver } from './diff/context.js';
import { ConsoleReporter } from './report/console.js';
import { reviewDiff } from './pipeline.js';

const program = new Command();

program
  .name('query-lens')
  .description('Flags potentially slow SQL in pull requests.')
  .version('0.0.1');

program
  .command('review')
  .description('Review the queries in a PR diff.')
  .option('-c, --config <path>', 'path to config file', DEFAULT_CONFIG_PATH)
  .option('--diff <path>', 'path to a unified diff file (alternative to fetching from GitHub)')
  .option('--pr <number>', 'GitHub PR number to review')
  .action(async (opts: { config: string; diff?: string; pr?: string }) => {
    const config = await loadConfig(opts.config);
    if (!opts.diff && !opts.pr) {
      throw new Error('one of --diff or --pr is required');
    }
    if (opts.pr) {
      // GitHub PR fetch + inline reporting lands in M4.
      throw new Error('--pr is not yet implemented; use --diff for now');
    }

    const diffText = await readFile(opts.diff!, 'utf8');
    const db = new PostgresAdapter(config.db.url);
    try {
      const resolver = await ContextResolver.create();
      const results = await reviewDiff({
        diffText,
        config,
        llm: createLlmClient(config.llm),
        db,
        resolver,
        readFile: (p) => readFile(p, 'utf8'),
      });
      new ConsoleReporter().report(results);
    } finally {
      await db.close();
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
