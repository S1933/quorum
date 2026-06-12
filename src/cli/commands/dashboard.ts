import { render } from 'ink';
import React from 'react';
import { Dashboard } from '../../ui/tui/app.tsx';
import type { CliDeps, CliIo } from '../types.ts';

function isTerminal(stream?: NodeJS.ReadStream | NodeJS.WriteStream): boolean {
  return stream?.isTTY === true;
}

export async function cmdDashboard(
  _positional: string[],
  flags: Record<string, string | boolean>,
  deps: CliDeps,
  io: CliIo,
): Promise<number> {
  const stdin = io.stdin ?? process.stdin;
  if (!isTerminal(stdin as NodeJS.ReadStream)) {
    io.stderr.write('error: dashboard requires an interactive terminal\n');
    return 1;
  }

  const configPath = typeof flags.config === 'string' ? flags.config : deps.findConfigPath();
  const config = await deps.loadConfigFromPath(configPath);
  const root = process.cwd();

  const { waitUntilExit } = render(
    React.createElement(Dashboard, { config, root }),
    {
      stdout: process.stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      exitOnCtrlC: false,
    },
  );

  await waitUntilExit();
  return 0;
}
