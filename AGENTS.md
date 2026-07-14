# Loop

Loop is a meta harness for Claude Code and co. It allows defining workflows and ralph loops that allow agents to run for a very long time.

## Techstack
- Bun (You MUST only use node compatible APIs)
- TypeScript in strict mode, ESM
- `@mariozechner/pi-tui` for TUI rendering

## Code Quality
- **All checks**: `bun run check` (runs biome with auto-fix, typecheck, tests, knip — context-optimized, only shows output on failure)

Before committing, run:
```bash
bun run check
```

## Commits
- You MUST use conventional commits (`feat:`, `fix:`, ...)
- Commit messages SHOULD be user focused. The reader will be actual consumer of the lib in the changelog

## Architecture
- `src/lib/` - Core logic (parser, runner, template engine, types)
- `src/agents/` - Agent abstraction layer (adapter interface, Claude adapter, stub for testing)
- `src/tui/` - TUI components (event routing, status bar, formatting)
- `src/testing/` - Test infrastructure (scenarios, helpers)
- `src/templates/` - Default LOOP.md template

Key design principle: The runner and TUI never import agent-specific code. Everything goes through the `AgentAdapter` interface.

Architecture decisions are documented in `docs/adr/`.

## CLI Output

- Make command output colorful and easy to scan.
- Reuse helpers from `src/lib/ansi.ts`. Never add raw ANSI escape sequences elsewhere.
- Use consistent semantic colors, such as green for success, yellow for skipped or warning states, cyan for paths, and dim text for secondary details.

## Persistence

- Define storage names and path composition only in `src/lib/storage-paths.ts`.
- Keep only project inputs in `.loop/`: `config.toml`, `LOOP.md`, and `recipes/`.
- Resolve personal config via `LOOP_CONFIG_HOME`, XDG config, then the platform default.
- Resolve runtime state via `LOOP_STATE_HOME`, XDG state, then the platform default.
- Store sessions at `<state-home>/sessions/<project-slug>/<session-id>/`.
- Keep `session.json` small and queryable. Append lifecycle records to `events.jsonl`.
- Never write runtime state, caches, or logs into the project.

## CLI Usage

```bash
# Run a single task
loop "Fix all TypeScript errors"

# Run tasks sequentially
loop "Write tests" "Review code"

# Repeat a task n times
loop "Fix lint errors" --repeat 3

# Loop with exit condition and safety cap
loop "Improve coverage" --until "Coverage above 80%" --max 5

# Repeat a group of tasks
loop [ "Write code" "Review" ] --repeat 3

# Create personal config and an example recipe
loop init

# Create a project scaffold with a LOOP.md template
loop init --project --include-template
```

### Claude Adapter Modes

The Claude adapter (`src/agents/claude.ts`) supports two modes:

- **Non-interactive (default):** Passes the prompt as a CLI argument to `claude -p`. Each loop iteration spawns a fresh process. No mid-session messaging. This is the most reliable mode.
- **Interactive:** Uses `--input-format stream-json` to send prompts via stdin, enabling multi-turn conversations within a single session. Enable with `createClaudeAdapter({ interactive: true })`.
