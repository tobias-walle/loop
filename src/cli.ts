#!/usr/bin/env node

import { handlePreTuiCommand } from "./commands/pre-command.js";
import { resumeCommand } from "./commands/resume-command.js";
import { runCommand } from "./commands/run-command.js";
import { ParseError, parseArgs } from "./lib/parser.js";

async function main(): Promise<number> {
  let config: ReturnType<typeof parseArgs>;
  try {
    config = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ParseError) {
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
