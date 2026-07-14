const COMMANDS = {
  resume: "Inspect and continue an unfinished session",
  init: "Create user or project config and an example recipe",
  "init-recipe <name>": "Create a user or project YAML recipe template",
} as const;

const FLAGS = {
  "--until <condition>": "Loop until the agent signals the condition is met",
  "--repeat <n>": "Repeat the task exactly n times",
  "--max <n>": "Safety cap for --until loops (max iterations)",
  "--arg <flag[=value]>": "Pass an agent flag for this task or group",
  "--agent <claude|pi>": "Agent backend to use",
  "--recipe <name>, -r <name>": "Run a named YAML recipe from .loop/recipes or user recipes",
  "--user | --project": "Choose init scope (default: --user)",
  "--include-template": "Also create LOOP.md (project init only)",
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
  ["loop resume", "Inspect and continue an unfinished session"],
  ["loop init-recipe implement", "Create a personal YAML recipe template"],
  ["loop init --project --include-template", "Create a complete project scaffold"],
] as const;

export function formatHelp(): string {
  const lines: string[] = [
    "Usage: loop <tasks...> [flags] | loop <command> [options] | loop --recipe <name> [recipe-args...]",
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
