# Changelog

## Unreleased

- Add `loop resume` with a styled global session browser, live-format history, full interactive transcript replay, lock handling, and step-boundary continuation
- Persist resumable workflows, templates, agent settings, output, usage, and durable completion boundaries
- Refactor live output into an owned inline renderer while preserving streaming text, tool hierarchy, spinner, status bar, and native scrollback
- Emit plain, append-only output when stdout is redirected
- Isolate session browsing in an alternate screen that restores the shell before resumed execution
- Gracefully cancel active agents on SIGINT, SIGTERM, and SIGHUP
- Remove the undocumented public `createLoopTUI`, `LoopTUI`, and `LoopTUIOptions` API

## 0.1.0

Initial release.

- Run single tasks, sequential pipelines, and looped workflows
- `--until` loops with agent-driven exit conditions
- `--repeat` for fixed iteration counts
- `--max` safety cap for unbounded loops
- Task grouping with `[ ... ]` bracket syntax
- Real-time TUI with streaming output, tool call display, and status bar
- Session logging as JSONL
- Token usage and cost tracking per step and run
- `loop init` to scaffold a customizable `LOOP.md` template
- `--help` / `--version` flags
- Claude Code adapter (pluggable agent interface)
