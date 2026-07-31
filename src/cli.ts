#!/usr/bin/env node

import { createProductionApplication } from "./commands/application.js";
import { handlePreTuiCommand } from "./commands/pre-command.js";
import { createProcessRunOutput } from "./commands/process-run-output.js";
import { createShutdownSignals } from "./commands/shutdown-signals.js";
import { CliError, parseCliArgs } from "./lib/cli-command.js";

async function main(): Promise<number> {
  using signals = createShutdownSignals();
  const stdout = createProcessRunOutput(process.stdout);
  let config: ReturnType<typeof parseCliArgs>;
  try {
    config = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliError) {
      console.error(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  if (handlePreTuiCommand(config, (message) => console.log(message))) return 0;
  const io = {
    stdout,
    signal: signals.signal,
    writeError: (message: string): void => console.error(message),
  };
  const application = createProductionApplication();
  const result =
    config.command === "resume" ? await application.resume(io) : await application.run(config, io);
  return signals.exitCode ?? result;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
