import { formatHelp } from "./cli-help.js";
import type { InitScope, LoopConfig, Step } from "./types";

export { formatHelp } from "./cli-help.js";

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export function parseArgs(args: string[]): LoopConfig {
  const passthroughIndex = args.indexOf("--");
  const passthroughArgs = passthroughIndex === -1 ? [] : args.slice(passthroughIndex + 1);
  const loopArgs = passthroughIndex === -1 ? args : args.slice(0, passthroughIndex);

  if (loopArgs.length === 0) {
    throw new ParseError(`No arguments provided.\n\n${formatHelp()}`);
  }

  if (loopArgs.includes("--help") || loopArgs.includes("-h")) {
    return { steps: [], command: "help" };
  }

  if (loopArgs.includes("--version") || loopArgs.includes("-v")) {
    return { steps: [], command: "version" };
  }

  if (args.includes("resume")) {
    if (args.length !== 1) throw new ParseError("resume accepts no other arguments.");
    return { steps: [], command: "resume" };
  }

  let agent: LoopConfig["agent"];
  let i = 0;
  while (i < loopArgs.length) {
    const arg = loopArgs[i];
    if (arg === "--agent") {
      if (i + 1 >= loopArgs.length) {
        throw new ParseError("--agent requires a value. Usage: --agent <claude|pi>");
      }
      const value = loopArgs[i + 1];
      if (value !== "claude" && value !== "pi") {
        throw new ParseError(`--agent must be "claude" or "pi", got "${value}".`);
      }
      agent = value;
      i += 2;
      continue;
    }

    if (arg === "--recipe" || arg === "-r") {
      if (i + 1 >= loopArgs.length || loopArgs[i + 1].startsWith("-")) {
        throw new ParseError(`${arg} requires a recipe name. Usage: ${arg} <name>`);
      }
      return withGlobalOptions(
        { steps: [], recipe: { name: loopArgs[i + 1], args: loopArgs.slice(i + 2) } },
        agent,
        passthroughArgs,
      );
    }

    break;
  }

  // Handle subcommands
  if (loopArgs[i] === "init") {
    const options = parseInitOptions(loopArgs.slice(i + 1), "init");
    return withGlobalOptions(
      {
        steps: [],
        command: "init",
        initScope: options.scope,
        ...(options.includeTemplate ? { includeTemplate: true } : {}),
      },
      agent,
      passthroughArgs,
    );
  }

  if (loopArgs[i] === "init-recipe") {
    const options = parseInitOptions(loopArgs.slice(i + 1), "init-recipe");
    return withGlobalOptions(
      {
        steps: [],
        command: "init-recipe",
        initRecipeName: options.name,
        initScope: options.scope,
      },
      agent,
      passthroughArgs,
    );
  }

  if (i >= loopArgs.length) {
    throw new ParseError(`No tasks provided.\n\n${formatHelp()}`);
  }

  const steps: Step[] = [];

  while (i < loopArgs.length) {
    const arg = loopArgs[i];

    // Flags at the start or after another flag without a preceding element
    if (arg.startsWith("--")) {
      throw new ParseError(
        `Flag "${arg}" has no preceding task or group. Flags must follow a task or "]".`,
      );
    }

    if (arg === "[") {
      i++;
      const tasks: string[] = [];
      while (i < loopArgs.length && loopArgs[i] !== "]") {
        if (loopArgs[i] === "[") {
          throw new ParseError("Nested brackets are not supported. Use a flat structure instead.");
        }
        if (loopArgs[i].startsWith("--")) {
          throw new ParseError(
            `Flag "${loopArgs[i]}" inside a group is not allowed. Place flags after the closing "]".`,
          );
        }
        tasks.push(loopArgs[i]);
        i++;
      }
      if (i >= loopArgs.length) {
        throw new ParseError('Unclosed bracket. Expected "]" to close the group.');
      }
      if (tasks.length === 0) {
        throw new ParseError("Empty group. Add at least one task inside [ ].");
      }
      i++;
      const step: Step = { type: "group", tasks };
      i = consumeFlags(loopArgs, i, step);
      steps.push(step);
    } else if (arg === "]") {
      throw new ParseError('Unexpected "]" without a matching opening "[".');
    } else {
      // Plain task
      const step: Step = { type: "task", task: arg };
      i++;
      i = consumeFlags(loopArgs, i, step);
      steps.push(step);
    }
  }

  return withGlobalOptions({ steps }, agent, passthroughArgs);
}

function parseInitOptions(
  args: string[],
  command: "init" | "init-recipe",
): { scope: InitScope; includeTemplate: boolean; name?: string } {
  let explicitScope: InitScope | undefined;
  let includeTemplate = false;
  const names: string[] = [];

  for (const arg of args) {
    if (arg === "--user" || arg === "--project") {
      const scope = arg === "--user" ? "user" : "project";
      if (explicitScope && explicitScope !== scope) {
        throw new ParseError("--user and --project cannot be combined.");
      }
      explicitScope = scope;
    } else if (arg === "--include-template" && command === "init") {
      includeTemplate = true;
    } else if (arg.startsWith("-")) {
      throw new ParseError(`Unknown ${command} option "${arg}".`);
    } else {
      names.push(arg);
    }
  }

  const scope = explicitScope ?? "user";
  if (includeTemplate && scope !== "project") {
    throw new ParseError("--include-template requires --project.");
  }
  if (command === "init" && names.length > 0) {
    throw new ParseError(`init accepts no positional arguments, got "${names[0]}".`);
  }
  if (command === "init-recipe" && names.length === 0) {
    throw new ParseError("init-recipe requires a name. Usage: loop init-recipe <name>");
  }
  if (command === "init-recipe" && names.length > 1) {
    throw new ParseError(`init-recipe accepts exactly one name, got extra argument "${names[1]}".`);
  }

  return { scope, includeTemplate, name: names[0] };
}

function withGlobalOptions(
  config: LoopConfig,
  agent: LoopConfig["agent"],
  passthroughArgs: string[],
): LoopConfig {
  if (agent) config.agent = agent;
  if (passthroughArgs.length > 0) config.passthroughArgs = passthroughArgs;
  return config;
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
    } else if (flag === "--arg") {
      if (pos + 1 >= args.length) {
        throw new ParseError("--arg requires a flag. Usage: --arg permission-mode=auto");
      }
      pos++;
      const parsed = parseAgentArg(args[pos]);
      step.args = { ...(step.args ?? {}), [parsed.name]: parsed.value };
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

function parseAgentArg(raw: string): { name: string; value: string | boolean } {
  const equals = raw.indexOf("=");
  const name = equals === -1 ? raw : raw.slice(0, equals);
  const value = equals === -1 ? true : raw.slice(equals + 1);

  if (!name || name.startsWith("-")) {
    throw new ParseError(`--arg expects flag or flag=value without leading dashes, got "${raw}".`);
  }
  if (equals !== -1 && value === "") {
    throw new ParseError(`--arg value for "${name}" cannot be empty.`);
  }

  return { name, value };
}
