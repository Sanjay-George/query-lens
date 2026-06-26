#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { loadConfig, DEFAULT_CONFIG_PATH } from './config.js';
import { createLlmClient } from './llm/factory.js';
import { createDbAdapter } from './db/factory.js';
import { ContextResolver } from './diff/context.js';
import { ConsoleReporter } from './report/console.js';
import { GithubReporter } from './report/github.js';
import { createGithubClient, type GithubClient } from './report/github-client.js';
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
  .option('--diff <path>', 'path to a unified diff file to review (instead of PR)')
  .option('--pr <number>', 'GitHub PR number to review and comment on')
  .option('--repo <owner/name>', 'GitHub repository (defaults to $GITHUB_REPOSITORY)')
  .action(async (opts: { config: string; diff?: string; pr?: string; repo?: string }) => {
    // load config
    const config = await loadConfig(opts.config);
    if (!opts.diff && !opts.pr) {
      throw new Error('one of --diff or --pr is required');
    }

    // Resolve the diff (either read from a file or fetched from GitHub)
    let diffText: string;
    let github: { client: GithubClient; owner: string; repo: string; pullNumber: number } | null = null;
    if (opts.pr) {
      const pullNumber = Number(opts.pr);
      if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
        throw new Error(`--pr must be a positive integer, got "${opts.pr}"`);
      }
      const slug = opts.repo ?? process.env.GITHUB_REPOSITORY;
      if (!slug) throw new Error('set --repo <owner/name> or the GITHUB_REPOSITORY env var');
      const [owner, repo] = slug.split('/');
      if (!owner || !repo) throw new Error(`--repo must be "owner/name", got "${slug}"`);
      
      const client = createGithubClient(requireEnv('GITHUB_TOKEN'));
      github = { client, owner, repo, pullNumber };
      
      diffText = await client.fetchPrDiff(owner, repo, pullNumber);
    } else {
      diffText = await readFile(opts.diff!, 'utf8');
    }

    // Run the review pipeline
    const db = createDbAdapter(config.db);
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
      
      // Report results to console
      // eslint-disable-next-line no-console
      new ConsoleReporter().report(results);
      
      // Report results to GitHub if applicable
      if (github) {
        await new GithubReporter(
          github.client,
          { owner: github.owner, repo: github.repo, pullNumber: github.pullNumber, diffText },
          // eslint-disable-next-line no-console
          console.log,
        ).report(results);
      }
    } finally {
      await db.close();
    }
  });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

program.parseAsync(process.argv).catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
