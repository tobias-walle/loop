import { CliError } from "./cli-error.js";
import type { Step } from "./types.js";

export function parseWorkflow(args: string[]): Step[] {
  if (args.length === 0) {
    throw new CliError("No arguments provided.");
  }

  const steps: Step[] = [];
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      throw new CliError(
        `Flag "${arg}" has no preceding task or group. Flags must follow a task or "]".`,
      );
    }

    if (arg === "[") {
      index++;
      const tasks: string[] = [];
      while (index < args.length && args[index] !== "]") {
        if (args[index] === "[") {
          throw new CliError("Nested brackets are not supported. Use a flat structure instead.");
        }
        if (args[index].startsWith("--")) {
          throw new CliError(
            `Flag "${args[index]}" inside a group is not allowed. Place flags after the closing "]".`,
          );
        }
        tasks.push(args[index]);
        index++;
      }
      if (index >= args.length) {
        throw new CliError('Unclosed bracket. Expected "]" to close the group.');
      }
      if (tasks.length === 0) {
        throw new CliError("Empty group. Add at least one task inside [ ].");
      }
      const step: Step = { type: "group", tasks };
      index = consumeStepOptions(args, index + 1, step);
      steps.push(step);
    } else if (arg === "]") {
      throw new CliError('Unexpected "]" without a matching opening "[".');
    } else {
      const step: Step = { type: "task", task: arg };
      index = consumeStepOptions(args, index + 1, step);
      steps.push(step);
    }
  }

  return steps;
}

function consumeStepOptions(args: string[], startIndex: number, step: Step): number {
  let position = startIndex;
  while (position < args.length && args[position].startsWith("--")) {
    const option = args[position];
    if (option === "--until") {
      const value = requireOptionValue(
        args,
        position,
        "--until",
        'a condition string. Usage: --until "condition"',
      );
      step.until = value;
      position += 2;
    } else if (option === "--repeat") {
      step.repeat = parsePositiveInteger(
        requireOptionValue(args, position, "--repeat", "a positive integer. Usage: --repeat 3"),
        "--repeat",
      );
      position += 2;
    } else if (option === "--max") {
      step.max = parsePositiveInteger(
        requireOptionValue(args, position, "--max", "a positive integer. Usage: --max 10"),
        "--max",
      );
      position += 2;
    } else if (option === "--arg") {
      const parsed = parseAgentArg(
        requireOptionValue(args, position, "--arg", "a flag. Usage: --arg permission-mode=auto"),
      );
      step.args = { ...(step.args ?? {}), [parsed.name]: parsed.value };
      position += 2;
    } else {
      throw new CliError(`Unknown flag "${option}".`);
    }
  }

  if (step.repeat !== undefined && step.until !== undefined) {
    throw new CliError(
      "--repeat and --until cannot be combined. Use --repeat for a fixed count or --until for a condition.",
    );
  }
  if (step.repeat !== undefined && step.max !== undefined) {
    throw new CliError(
      "--repeat and --max cannot be combined. --repeat already specifies an exact count.",
    );
  }
  if (step.max !== undefined && step.until === undefined) {
    throw new CliError(
      "--max can only be used with --until. It acts as a safety cap for until-loops.",
    );
  }
  return position;
}

function requireOptionValue(
  args: string[],
  position: number,
  option: string,
  requirement: string,
): string {
  if (position + 1 >= args.length) {
    throw new CliError(`${option} requires ${requirement}`);
  }
  return args[position + 1];
}

function parsePositiveInteger(raw: string, option: "--repeat" | "--max"): number {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value !== Number(raw) || value <= 0) {
    throw new CliError(`${option} requires a positive integer, got "${raw}".`);
  }
  return value;
}

function parseAgentArg(raw: string): { name: string; value: string | boolean } {
  const equals = raw.indexOf("=");
  const name = equals === -1 ? raw : raw.slice(0, equals);
  const value = equals === -1 ? true : raw.slice(equals + 1);
  if (!name || name.startsWith("-")) {
    throw new CliError(`--arg expects flag or flag=value without leading dashes, got "${raw}".`);
  }
  if (equals !== -1 && value === "") {
    throw new CliError(`--arg value for "${name}" cannot be empty.`);
  }
  return { name, value };
}
