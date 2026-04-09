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

## Session Logging

Each run creates a session directory at `.loop/sessions/<date>-<hash>/` containing a `session.jsonl` file. This is a structured JSONL log with full debug coverage of the run lifecycle.

Each line is a JSON object with at least `timestamp`, `level` (`debug`|`info`|`warn`|`error`), and `message`, plus arbitrary structured data fields. Covers: config parsing, template loading, step/iteration lifecycle, agent events, tool calls, retries, rate limits, abort handling, and run summaries.

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

# Create a LOOP.md template in the current directory
loop init
```

### Claude Adapter Modes

The Claude adapter (`src/agents/claude.ts`) supports two modes:

- **Non-interactive (default):** Passes the prompt as a CLI argument to `claude -p`. Each loop iteration spawns a fresh process. No mid-session messaging. This is the most reliable mode.
- **Interactive:** Uses `--input-format stream-json` to send prompts via stdin, enabling multi-turn conversations within a single session. Enable with `createClaudeAdapter({ interactive: true })`.
