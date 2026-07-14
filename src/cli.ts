#!/usr/bin/env node

import { handlePreTuiCommand } from "./commands/pre-command.js";
import { resumeCommand } from "./commands/resume-command.js";
import { runCommand } from "./commands/run-command.js";
import { CliError, parseCliArgs } from "./lib/cli-command.js";

async function main(): Promise<number> {
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
  if (config.command === "resume")
    return resumeCommand({ writeError: (message) => console.error(message) });
  return runCommand(config, { writeError: (message) => console.error(message) });
}

main()
  .then((exitCode) => process.exit(exitCode))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
