import type { LoopConfig, Step } from "./types";

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export function parseArgs(args: string[]): LoopConfig {
  if (args.length === 0) {
    throw new ParseError('No arguments provided. Usage: loop "task" or loop init');
  }

  // Handle subcommands
  if (args[0] === "init") {
    return { steps: [], command: "init" };
  }

  const steps: Step[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    // Flags at the start or after another flag without a preceding element
    if (arg.startsWith("--")) {
      throw new ParseError(
        `Flag "${arg}" has no preceding task or group. Flags must follow a task or "]".`,
      );
    }

    if (arg === "[") {
      // Parse group
      i++;
      const tasks: string[] = [];
      while (i < args.length && args[i] !== "]") {
        if (args[i] === "[") {
          throw new ParseError("Nested brackets are not supported. Use a flat structure instead.");
        }
        if (args[i].startsWith("--")) {
          throw new ParseError(
            `Flag "${args[i]}" inside a group is not allowed. Place flags after the closing "]".`,
          );
        }
        tasks.push(args[i]);
        i++;
      }
      if (i >= args.length) {
        throw new ParseError('Unclosed bracket. Expected "]" to close the group.');
      }
      if (tasks.length === 0) {
        throw new ParseError("Empty group. Add at least one task inside [ ].");
      }
      // Skip the "]"
      i++;
      const step: Step = { type: "group", tasks };
      i = consumeFlags(args, i, step);
      steps.push(step);
    } else if (arg === "]") {
      throw new ParseError('Unexpected "]" without a matching opening "[".');
    } else {
      // Plain task
      const step: Step = { type: "task", task: arg };
      i++;
      i = consumeFlags(args, i, step);
      steps.push(step);
    }
  }

  return { steps };
}

function consumeFlags(args: string[], startIndex: number, step: Step): number {
  let pos = startIndex;
  while (pos < args.length && args[pos].startsWith("--")) {
    const flag = args[pos];

    if (flag === "--until") {
      if (pos + 1 >= args.length) {
        throw new ParseError('--until requires a condition string. Usage: --until "condition"');
      }
      pos++;
      step.until = args[pos];
      pos++;
    } else if (flag === "--repeat") {
      if (pos + 1 >= args.length) {
        throw new ParseError("--repeat requires a positive integer. Usage: --repeat 3");
      }
      pos++;
      const value = Number.parseInt(args[pos], 10);
      if (Number.isNaN(value) || value !== Number(args[pos]) || value <= 0) {
        throw new ParseError(`--repeat requires a positive integer, got "${args[pos]}".`);
      }
      step.repeat = value;
      pos++;
    } else if (flag === "--max") {
      if (pos + 1 >= args.length) {
        throw new ParseError("--max requires a positive integer. Usage: --max 10");
      }
      pos++;
      const value = Number.parseInt(args[pos], 10);
      if (Number.isNaN(value) || value !== Number(args[pos]) || value <= 0) {
        throw new ParseError(`--max requires a positive integer, got "${args[pos]}".`);
      }
      step.max = value;
      pos++;
    } else {
      throw new ParseError(`Unknown flag "${flag}".`);
    }
  }

  // Validate flag combinations
  if (step.repeat !== undefined && step.until !== undefined) {
    throw new ParseError(
      "--repeat and --until cannot be combined. Use --repeat for a fixed count or --until for a condition.",
    );
  }
  if (step.repeat !== undefined && step.max !== undefined) {
    throw new ParseError(
      "--repeat and --max cannot be combined. --repeat already specifies an exact count.",
    );
  }
  if (step.max !== undefined && step.until === undefined) {
    throw new ParseError(
      "--max can only be used with --until. It acts as a safety cap for until-loops.",
    );
  }

  return pos;
}
