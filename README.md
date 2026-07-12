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

# Use pi for one run and pass raw pi-specific args
loop --agent pi "Fix tests" -- --profile fast

# Override agent flags for one step
loop "Review safely" --arg permission-mode=auto "Fix with bypass" --arg permission-mode=bypassPermissions

# Create a recipe template
loop init-recipe implement

# Run a named recipe
loop --recipe implement --plan ./PLAN.md
loop -r implement ./PLAN.md
```

### Grouping with brackets

Use `[` and `]` to group multiple tasks into a single step. Flags after `]` apply to the whole group.

```bash
# Repeat a group
loop "Create an about page" [ "Review code" "Fix issues" ] --repeat 3

# Loop a group until done
loop "Create an about page" [ "Review code" "Fix issues" ] --until "No issues" --max 10
```

### Recipes

Recipes are reusable YAML templates for steps. Project recipes live in `.loop/recipes/<name>.yaml`. Personal recipes live in the user config directory under `recipes/<name>.yaml`. Project recipes take precedence.

Create a starter recipe:

```bash
loop init-recipe implement
```

Recipe files are validated with a Zod schema before they run.

```yaml
# .loop/recipes/implement.yaml
description: Implement a plan phase by phase

arguments:
  - name: plan
    description: Plan file to implement
    type: file

steps:
  - task: Use the implement skill with the next phase in $PLAN. Commit and stop after every phase
    until: All phases are done and only manual verification remains
    args:
      permission-mode: auto

  - tasks:
      - Review the changes
      - Correct the findings
    repeat: 2
```

Run it with a named or positional argument:

```bash
loop --recipe implement --plan ./my-plan.md
loop -r implement ./my-plan.md
```

Recipe steps support the same task, group, `until`, `repeat`, `max`, and `args` features as CLI steps. Argument types are `string`, `path`, `file`, `directory`, `integer`, `number`, and `boolean`. Use `$PLAN`, `${PLAN}`, or `{{plan}}` in step strings.

### Flags

Flags bind to the immediately preceding task or `]`.

| Flag | Description |
|---|---|
| `--until "condition"` | Repeat until the condition is met |
| `--repeat N` | Repeat exactly N times |
| `--max N` | Safety cap for `--until` loops |
| `--arg flag[=value]` | Pass an agent flag to the current task or group |
| `--agent claude|pi` | Select the agent backend for this run |
| `--recipe NAME`, `-r NAME` | Run a named recipe |
| `--` | Pass remaining raw args to the selected agent |

### Configuration

Loop combines personal config with the nearest project `.loop/config.toml`. Set `LOOP_CONFIG_HOME` to choose the personal config directory. When it is unset, Loop uses `$XDG_CONFIG_HOME/loop` or the platform default documented under [Files and storage](#files-and-storage).

```toml
agent = "pi"

[agents.pi]
command = "pi"
model = "sonnet"
env = { PI_OFFLINE = "1" }

[agents.pi.args]
profile = "fast"

[agents.claude.args]
permission-mode = "auto"
```

Precedence is defaults, user config, project config, environment variables, then CLI flags. Supported environment overrides are `LOOP_AGENT`, `LOOP_PI_COMMAND`, `LOOP_PI_MODEL`, `LOOP_CLAUDE_COMMAND`, and `LOOP_CLAUDE_MODEL`.

Agent args use TOML tables. Keys map directly to CLI flags without case changes. String values render as `--flag value`, `true` renders as `--flag`, and `false` omits the flag.

```toml
[agents.claude.args]
permission-mode = "bypassPermissions"
some-boolean-flag = true
disabled-flag = false
```

Claude defaults to `permission-mode = "auto"`. To use permission bypass behavior, set `permission-mode = "bypassPermissions"` globally or pass it for a single step:

```bash
loop "Fix tests" --arg permission-mode=bypassPermissions
```

### Project template

Run `loop init` to generate `.loop/LOOP.md`. This file controls how the agent is prompted inside loops. It uses `{{placeholder}}` and `{{#if var}}...{{/if}}` syntax. Commit it to your repo and customize it per project.

## Files and storage

Loop keeps project configuration in `.loop/`, personal configuration in the platform config directory, and runtime history in the platform state directory. Running Loop does not add session logs to your project.

### Project files

```text
.loop/
├── config.toml      # Shared project defaults
├── LOOP.md          # Prompt template used for each task
└── recipes/         # Reusable project workflows
    └── review.yaml
```

These are project inputs. They can be committed when the team should share them.

### Personal config files

```text
<config-home>/
├── config.toml      # Personal agent and command defaults
└── recipes/         # Recipes available in every project
```

| Platform | Default config home |
|---|---|
| Linux | `~/.config/loop` |
| macOS | `~/Library/Application Support/loop/config` |
| Windows | `%APPDATA%\loop` |

`LOOP_CONFIG_HOME` overrides the whole config home. `$XDG_CONFIG_HOME/loop` takes precedence over the platform default when `XDG_CONFIG_HOME` is set.

### Session state

```text
<state-home>/sessions/<project-slug>/<session-id>/
├── session.json     # Project path, timestamps, and completion status
└── events.jsonl     # Append-only structured lifecycle events
```

| Platform | Default state home |
|---|---|
| Linux | `~/.local/state/loop` |
| macOS | `~/Library/Application Support/loop/state` |
| Windows | `%LOCALAPPDATA%\loop` |

`LOOP_STATE_HOME` overrides the whole state home. `$XDG_STATE_HOME/loop` takes precedence over the platform default when `XDG_STATE_HOME` is set.

Project slugs combine the folder name with a short hash, so projects with the same name do not share sessions. Session IDs start with a UTC timestamp, making directories sortable. Loop retains sessions until you delete them.

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

