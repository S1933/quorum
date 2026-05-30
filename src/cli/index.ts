#!/usr/bin/env bun
import { loadConfigFromPath, findConfigPath } from '../config/loader.ts';
import { createRuntime as createRuntimeDefault } from '../runtime/runtime.ts';
import { probeWorkspace, inferRepoRoot } from '../runtime/workspace.ts';
import { QuorumError } from '../core/errors.ts';
import { parseArgs } from './args.ts';
import { cmdReview } from './commands/review.ts';
import { cmdConfig } from './commands/config.ts';
import type { CliDeps, CliIo } from './types.ts';

export type { CliDeps, CliIo } from './types.ts';
export { redactConfig } from './commands/config.ts';
export {
  buildSafeFence,
  buildReviewInstruction,
  filterReviewersByChangedFiles,
  resolveDiffLimits,
} from './commands/review.ts';

const defaultIo: CliIo = {
  stdout: process.stdout,
  stderr: process.stderr,
};

const defaultDeps: CliDeps = {
  loadConfigFromPath,
  findConfigPath,
  inferRepoRoot,
  probeWorkspace,
  createRuntime: createRuntimeDefault,
  now: Date.now,
};

function printHelp(io: CliIo): void {
  io.stdout.write(`quorum — multi-model consensus reviewer

Usage:
  quorum review [pipeline-id] [--pipeline <id>] [--base <ref>] [--config <path>] [--report <path>] [--format text|json] [--json] [--no-color] [--no-preview] [--max-diff-bytes <n>] [--include <glob>] [--exclude <glob>]
  quorum config [--config <path>]
  quorum help

Defaults are read from quorum.yaml in the working directory.
`);
}

export async function main(
  argv: string[] = process.argv.slice(2),
  deps: CliDeps = defaultDeps,
  io: CliIo = defaultIo,
): Promise<number> {
  const { command, positional, flags } = parseArgs(argv);

  try {
    switch (command) {
      case 'help':
      case '-h':
      case '--help':
        printHelp(io);
        return 0;
      case 'review':
        return await cmdReview(positional, flags, deps, io);
      case 'config':
        return await cmdConfig(flags, deps, io);
      default:
        io.stderr.write(`Unknown command: ${command}\n\n`);
        printHelp(io);
        return 2;
    }
  } catch (err) {
    if (err instanceof QuorumError) {
      io.stderr.write(`error: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
