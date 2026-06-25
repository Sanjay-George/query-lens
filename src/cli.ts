#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, DEFAULT_CONFIG_PATH } from './config.js';

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
    // eslint-disable-next-line no-console
    console.log('[query-lens] loaded config for dialect:', config.db.dialect);
    if (!opts.diff && !opts.pr) {
      throw new Error('one of --diff or --pr is required');
    }
    // TODO(M1+): diff fetch → extract → analyze → judge → optimize → report
    // eslint-disable-next-line no-console
    console.log('[query-lens] pipeline not yet implemented (M0 scaffold)');
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
