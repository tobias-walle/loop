# Loop

A CLI tool that runs coding agents in loops and sequences with streaming terminal output. Ships with a Claude Code adapter, but the agent layer is abstracted so other agents can be plugged in.

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

# Inspect and continue unfinished sessions
loop resume

# Create personal config and an example recipe
loop init

# Create a personal recipe template
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

Create a personal starter recipe, or add one to the current project:

```bash
loop init-recipe implement
loop init-recipe implement --project
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
| `--user`, `--project` | Select the scope for `init` or `init-recipe` (default: user) |
| `--include-template` | Add `LOOP.md` during project init |
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

### Initialization

`loop init` creates a commented config and an example recipe in your personal config directory. Use `loop init --project` to create them under `.loop/` in the current project. Existing files are never overwritten.

The project template is opt-in:

```bash
loop init --project --include-template
```

`.loop/LOOP.md` controls how the agent is prompted inside loops. It uses `{{placeholder}}` and `{{#if var}}...{{/if}}` syntax. Commit it to your repo and customize it per project.

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
├── session.json     # Rebuildable overview projection
├── events.jsonl     # Authoritative invocation, progress, and output history
└── active.lock      # Present only while a process owns the session
```

| Platform | Default state home |
|---|---|
| Linux | `~/.local/state/loop` |
| macOS | `~/Library/Application Support/loop/state` |
| Windows | `%LOCALAPPDATA%\loop` |

`LOOP_STATE_HOME` overrides the whole state home. `$XDG_STATE_HOME/loop` takes precedence over the platform default when `XDG_STATE_HOME` is set.

Project slugs combine the folder name with a short hash, so projects with the same name do not share sessions. Session IDs start with a UTC timestamp, making directories sortable. Loop retains sessions until you delete them.

Run `loop resume` to browse sessions from every project, inspect their history, and continue an unfinished workflow. The selector and history view use semantic colors, and stored history is rendered with the same headers, assistant markers, tool hierarchy, nested-agent pipes, and completion boundaries as live output. The browser uses an isolated alternate screen. Use `j`/`k` or arrows for line navigation, `u`/`d` or Ctrl+u/Ctrl+d for half-page jumps, PageUp/PageDown for full pages, `g`/Home and `G`/End for the start and end, Enter to inspect or resume, and `q`/Escape to go back or exit. The alternate screen and terminal modes are restored before resumed output or the shell becomes visible.

Resume starts at the first incomplete step. In an interactive terminal, Loop first rebuilds the prior transcript from persisted events through the live renderer, then appends the new attempt. Completed steps are skipped, while an interrupted step restarts from iteration 1 in a fresh agent process. The stored workflow, template, agent settings, and project root are reused. Legacy and completed sessions remain viewable but cannot be continued. Redirected resume output does not repeat the prior transcript.

## How it works

Each step in the pipeline spawns a fresh agent session. For `--until` loops, the agent is instructed to end its response with `LOOP_DONE` or `LOOP_CONTINUE: <status>`. Loop checks the last line and decides whether to keep going or advance.

In an interactive terminal, live runs use an inline differential renderer. Assistant text streams as it arrives, tool calls and nested agents retain their visual hierarchy, and the waiting spinner and usage status stay live. The renderer updates only changed lines at the bottom of the terminal. It never enters raw mode or the alternate screen, and erase-scrollback controls are filtered so native scrolling, selection, resize, and zoom remain available.

The live renderer owns one animation clock, its resize listener, cursor restoration, and final render flushing. Ctrl+C requests graceful agent shutdown through process signals rather than terminal input handling. SIGTERM and SIGHUP use the same cleanup path with conventional exit codes.

When stdout is redirected, Loop switches to append-only plain text without ANSI color or terminal control sequences. Completed assistant blocks, tool calls, retries, and summaries remain suitable for files and pipelines.

## Development

```bash
bun install
bun run check         # biome, typecheck, dependencies, tests, knip, build, and smoke test
bun test              # run tests only
bun run build         # bundle to dist/
```

