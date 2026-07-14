import { Command, CommanderError, Option } from "commander";
import { CliError } from "./cli-error.js";
import type { InitScope, LoopConfig } from "./types.js";
import { parseWorkflow } from "./workflow-args.js";

export { CliError } from "./cli-error.js";

const DESCRIPTION = "Run AI agent tasks in sequence, loops, or groups.";

const GROUPS_AND_EXAMPLES = `
Groups:
  [ "task1" "task2" ]     Run multiple tasks as a single step
                           Options apply to the whole group when placed after ]

Examples:
  loop "Fix all TypeScript errors"
  loop "Write tests" "Review code"
  loop "Fix lint errors" --repeat 3
  loop "Improve coverage" --until "Coverage above 80%" --max 5
  loop "Review" --arg permission-mode=auto
  loop --agent pi "Fix tests" -- --profile fast
  loop [ "Write code" "Review" ] --repeat 3
  loop --recipe implement --plan ./PLAN.md
  loop init --project --include-template`;

type ConfigHandler = (config: LoopConfig) => void;

export function createCliCommand(
  onConfig: ConfigHandler = () => {},
  rawArgs: readonly string[] = [],
  writeHelp: (text: string) => void = () => {},
): Command {
  const program = new Command()
    .name("loop")
    .description(DESCRIPTION)
    .usage("<tasks...> [options] | <command> [options] | --recipe <name> [recipe-args...]")
    .helpOption("-h, --help", "show help")
    .allowUnknownOption()
    .allowExcessArguments()
    .addOption(new Option("--agent <agent>", "agent backend to use").choices(["claude", "pi"]))
    .option("-r, --recipe <name>", "run a named YAML recipe")
    .option("--until <condition>", "loop until the agent signals the condition is met")
    .option("--repeat <n>", "repeat the preceding task or group exactly n times")
    .option("--max <n>", "safety cap for an until-loop")
    .option("--arg <flag=value>", "pass an agent flag to the preceding task or group")
    .option("-v, --version", "show version")
    .argument("[tasks...]")
    .addHelpText("after", GROUPS_AND_EXAMPLES)
    .configureOutput({ writeOut: writeHelp, writeErr: () => {} })
    .exitOverride();

  program.action((_tasks: string[], options: Record<string, unknown>) => {
    if (options.version) {
      onConfig({ steps: [], command: "version" });
      return;
    }

    const { loopArgs, passthroughArgs } = splitPassthrough(rawArgs);
    const agent = options.agent as LoopConfig["agent"];
    const recipe = options.recipe as string | undefined;
    if (recipe !== undefined) {
      const recipeOptionIndex = loopArgs.findIndex((arg) => arg === "--recipe" || arg === "-r");
      const recipeArgs = loopArgs.slice(recipeOptionIndex + 2);
      onConfig(
        withGlobalOptions(
          { steps: [], recipe: { name: recipe, args: recipeArgs } },
          agent,
          passthroughArgs,
        ),
      );
      return;
    }

    const workflowArgs = removeGlobalAgentOptions(loopArgs);
    onConfig(withGlobalOptions({ steps: parseWorkflow(workflowArgs) }, agent, passthroughArgs));
  });

  program
    .command("resume")
    .description("inspect and continue an unfinished session")
    .allowExcessArguments(false)
    .action(() => {
      if (rawArgs.length !== 1) {
        throw new CliError("resume accepts no other arguments.");
      }
      onConfig({ steps: [], command: "resume" });
    });

  program
    .command("init")
    .description("create user or project config and an example recipe")
    .allowExcessArguments(false)
    .option("--user", "create personal configuration")
    .option("--project", "create project configuration")
    .option("--include-template", "also create LOOP.md")
    .action((options: { user?: boolean; project?: boolean; includeTemplate?: boolean }) => {
      validateInitScope(options);
      const scope = getInitScope(options);
      if (options.includeTemplate && scope !== "project") {
        throw new CliError("--include-template requires --project.");
      }
      onConfig(
        withGlobalOptions(
          {
            steps: [],
            command: "init",
            initScope: scope,
            ...(options.includeTemplate ? { includeTemplate: true } : {}),
          },
          program.opts().agent as LoopConfig["agent"],
          [],
        ),
      );
    });

  program
    .command("init-recipe")
    .description("create a user or project YAML recipe template")
    .allowExcessArguments(false)
    .option("--user", "create a personal recipe")
    .option("--project", "create a project recipe")
    .argument("<name>", "recipe name")
    .action((name: string, options: { user?: boolean; project?: boolean }) => {
      validateInitScope(options);
      onConfig(
        withGlobalOptions(
          {
            steps: [],
            command: "init-recipe",
            initRecipeName: name,
            initScope: getInitScope(options),
          },
          program.opts().agent as LoopConfig["agent"],
          [],
        ),
      );
    });

  return program;
}

export function parseCliArgs(args: string[]): LoopConfig {
  const passthroughIndex = args.indexOf("--");
  const commandArgs = passthroughIndex === -1 ? args : args.slice(0, passthroughIndex);
  if (commandArgs.includes("--version") || commandArgs.includes("-v")) {
    return { steps: [], command: "version" };
  }

  let config: LoopConfig | undefined;
  let helpText = "";
  const program = createCliCommand(
    (parsed) => {
      config = parsed;
    },
    args,
    (text) => {
      helpText += text;
    },
  );
  try {
    program.parse(["node", "loop", ...args]);
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed") {
        return { steps: [], command: "help", helpText };
      }
      throw new CliError(error.message.replace(/^error: /, ""));
    }
    throw error;
  }
  if (!config) throw new CliError("Unable to parse CLI arguments.");
  return config;
}

export function formatHelp(): string {
  let helpText = "";
  createCliCommand(undefined, undefined, (text) => {
    helpText += text;
  }).outputHelp();
  return helpText;
}

function splitPassthrough(args: readonly string[]): {
  loopArgs: string[];
  passthroughArgs: string[];
} {
  const index = args.indexOf("--");
  return index === -1
    ? { loopArgs: [...args], passthroughArgs: [] }
    : { loopArgs: args.slice(0, index), passthroughArgs: args.slice(index + 1) };
}

function removeGlobalAgentOptions(args: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--agent") {
      index++;
    } else {
      result.push(args[index]);
    }
  }
  return result;
}

function validateInitScope(options: { user?: boolean; project?: boolean }): void {
  if (options.user && options.project) {
    throw new CliError("--user and --project cannot be combined.");
  }
}

function getInitScope(options: { user?: boolean; project?: boolean }): InitScope {
  return options.project ? "project" : "user";
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
