# Loop

A CLI tool that runs coding agents in loops and sequences with a minimal TUI for monitoring and interaction. Ships with a Claude Code adapter, but the agent layer is abstracted so other agents can be plugged in.

## Installation

Requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code) by default. You can also opt in to [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) as an agent backend.

Loop is not yet published to a registry. Install from source:

```bash
git clone https://github.com/tobias-walle/loop.git
cd loop
bun install
bun run build
bun link
```

## Usage

```bash
# Single task
loop "Create an about page"

# Sequential tasks (each runs in a new session)
loop "Create an about page" "Review the code" "Fix issues"

# Loop until a condition is met
loop "Work on next task in PLAN.md" --until "All tasks are done"

# Loop with a safety cap
loop "Work on next task in PLAN.md" --until "All tasks are done" --max 10

# Fixed repeat
loop "Run the test suite and fix failures" --repeat 3

# Use pi for one run and pass pi-specific args
loop --agent pi "Fix tests" -- --profile fast
```

### Grouping with brackets

Use `[` and `]` to group multiple tasks into a single step. Flags after `]` apply to the whole group.

```bash
# Repeat a group
loop "Create an about page" [ "Review code" "Fix issues" ] --repeat 3

# Loop a group until done
loop "Create an about page" [ "Review code" "Fix issues" ] --until "No issues" --max 10
```

### Flags

Flags bind to the immediately preceding task or `]`.

| Flag | Description |
|---|---|
| `--until "condition"` | Repeat until the condition is met |
| `--repeat N` | Repeat exactly N times |
| `--max N` | Safety cap for `--until` loops |
| `--agent claude|pi` | Select the agent backend for this run |
| `--` | Pass remaining args to the selected agent |

### Configuration

Loop reads TOML config from `$LOOP_CONFIG_HOME/config.toml`, `$XDG_CONFIG_HOME/loop/config.toml`, or `~/.config/loop/config.toml`, plus the nearest project `.loop/config.toml`.

```toml
agent = "pi"

[agents.pi]
command = "pi"
model = "sonnet"
args = ["--profile", "fast"]
env = { PI_OFFLINE = "1" }
```

Precedence is defaults, user config, project config, environment variables, then CLI flags. Supported environment overrides are `LOOP_AGENT`, `LOOP_PI_COMMAND`, `LOOP_PI_MODEL`, `LOOP_CLAUDE_COMMAND`, and `LOOP_CLAUDE_MODEL`.

### Project template

Run `loop init` to generate a `LOOP.md` file in your project root. This file controls how the agent is prompted inside loops. It uses `{{placeholder}}` and `{{#if var}}...{{/if}}` syntax. Commit it to your repo and customize it per project.

## How it works

Each step in the pipeline spawns a fresh agent session. For `--until` loops, the agent is instructed to end its response with `LOOP_DONE` or `LOOP_CONTINUE: <status>`. Loop checks the last line and decides whether to keep going or advance.

The TUI streams agent output in real time: text, tool calls, retries, and subagent activity. A status bar at the bottom shows the current step, iteration, cost, and elapsed time.

## Development

```bash
bun install
bun run check         # biome, typecheck, tests, and knip (run before committing)
bun test              # run tests only
bun run build         # bundle to dist/
```

Sessions are logged to `.loop/sessions/<date>-<hash>/session.jsonl` as structured JSONL covering the full run lifecycle (config, steps, iterations, agent events, tool calls, retries, rate limits, aborts, and summaries).
