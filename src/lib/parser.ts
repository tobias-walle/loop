import type { LoopConfig, Step } from "./types";

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

const COMMANDS = {
  init: "Create a .loop/LOOP.md project template",
  "init-recipe <name>": "Create a YAML recipe template in .loop/recipes",
} as const;

const FLAGS = {
  "--until <condition>": "Loop until the agent signals the condition is met",
  "--repeat <n>": "Repeat the task exactly n times",
  "--max <n>": "Safety cap for --until loops (max iterations)",
  "--arg <flag[=value]>": "Pass an agent flag for this task or group",
  "--agent <claude|pi>": "Agent backend to use",
  "--recipe <name>, -r <name>": "Run a named YAML recipe from .loop/recipes or user recipes",
  "--": "Pass remaining raw args to the selected agent",
  "--help, -h": "Show this help message",
  "--version, -v": "Show version number",
} as const;

const EXAMPLES = [
  ['loop "Fix all TypeScript errors"', "Run a single task"],
  ['loop "Write tests" "Review code"', "Run tasks sequentially"],
  ['loop "Fix lint errors" --repeat 3', "Repeat a task 3 times"],
  ['loop "Improve coverage" --until "Coverage above 80%" --max 5', "Loop with a condition and cap"],
  ['loop "Review" --arg permission-mode=auto', "Pass an agent flag to one step"],
  [
    'loop "Fix" --arg permission-mode=bypassPermissions',
    "Override Claude permission mode for one step",
  ],
  ['loop --agent pi "Fix tests" -- --profile fast', "Use pi and pass raw args to it"],
  ['loop [ "Write code" "Review" ] --repeat 3', "Repeat a group of tasks"],
  ["loop --recipe implement --plan ./PLAN.md", "Run a named recipe with a named argument"],
  ["loop -r implement ./PLAN.md", "Run a named recipe with a positional argument"],
  ["loop init-recipe implement", "Create a YAML recipe template"],
  ["loop init", "Create a .loop/LOOP.md project template"],
] as const;

export function formatHelp(): string {
  const lines: string[] = [
    "Usage: loop <tasks...> [flags] | loop --recipe <name> [recipe-args...] | loop init-recipe <name>",
    "",
    "Run AI agent tasks in sequence, loops, or groups.",
    "",
    "Commands:",
  ];

  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    lines.push(`  ${cmd.padEnd(24)} ${desc}`);
  }

  lines.push("", "Flags:");
  for (const [flag, desc] of Object.entries(FLAGS)) {
    lines.push(`  ${flag.padEnd(24)} ${desc}`);
  }

  lines.push("", "Groups:");
  lines.push('  [ "task1" "task2" ]     Run multiple tasks as a single step');
  lines.push("                         Flags apply to the whole group when placed after ]");

  lines.push("", "Examples:");
  for (const [cmd, desc] of EXAMPLES) {
    lines.push(`  ${cmd}`);
    lines.push(`      ${desc}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function parseArgs(args: string[]): LoopConfig {
  const passthroughIndex = args.indexOf("--");
  const passthroughArgs = passthroughIndex === -1 ? [] : args.slice(passthroughIndex + 1);
  const loopArgs = passthroughIndex === -1 ? args : args.slice(0, passthroughIndex);

  if (loopArgs.length === 0) {
    throw new ParseError(`No arguments provided.\n\n${formatHelp()}`);
  }

  // Handle --help / -h anywhere in args
  if (loopArgs.includes("--help") || loopArgs.includes("-h")) {
    return { steps: [], command: "help" };
  }

  // Handle --version / -v
  if (loopArgs.includes("--version") || loopArgs.includes("-v")) {
    return { steps: [], command: "version" };
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
    return withGlobalOptions({ steps: [], command: "init" }, agent, passthroughArgs);
  }

  if (loopArgs[i] === "init-recipe") {
    if (i + 1 >= loopArgs.length || loopArgs[i + 1].startsWith("-")) {
      throw new ParseError("init-recipe requires a name. Usage: loop init-recipe <name>");
    }
    if (i + 2 < loopArgs.length) {
      throw new ParseError(
        `init-recipe accepts exactly one name, got extra argument "${loopArgs[i + 2]}".`,
      );
    }
    return withGlobalOptions(
      { steps: [], command: "init-recipe", initRecipeName: loopArgs[i + 1] },
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
      // Parse group
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
      // Skip the "]"
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
