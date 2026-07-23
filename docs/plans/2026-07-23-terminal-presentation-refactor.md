# Terminal presentation refactor plan

Date: 2026-07-23
Status: Implemented, manual verification pending

## Objective

Separate terminal presentation by use case without changing Loop's interactive visual design:

1. Interactive live runs use the original streaming UI through a clean inline terminal lifecycle.
2. Redirected live runs use append-only plain output.
3. Session browsing uses a short-lived alternate-screen TUI with an internal viewport.

The refactor must preserve persistence, resume behavior, agent event semantics, streamed assistant output, tool hierarchy, nested agents, waiting indicators, status reporting, interruption, and terminal cleanup.

## Corrected design decision

The first implementation of this plan replaced live rendering with append-only records. That removed streaming deltas, the waiting spinner, nested live presentation, and the status bar. This was a user-visible design regression.

Append-only output remains correct for redirection but is not the interactive design. The final architecture uses `pi-tui` differential rendering for TTY runs. Spinner ticks and text deltas replace lines in the live region without appending a new terminal line on each frame. The terminal emulator continues to own scrollback.

This correction retains the useful boundaries from the first refactor:

- Execution emits persisted `SessionEvent` records and does not import TUI code.
- Commands choose and own a reporter.
- Interactive live rendering and the browser never share a terminal session.
- Process signals, not raw terminal input, cancel a run.
- Redirected output remains stable and control-free.
- The browser remains pure Model-Update-View inside an isolated alternate screen.

## Design principles

- Orthogonality: execution, persistence, live presentation, redirected output, browsing, and signal handling change independently.
- DRY as knowledge: all presentation paths consume the same persisted event vocabulary.
- Resource ownership: reporter, animation clock, resize listener, browser input, and terminal modes have explicit owners.
- Preserve behavior: refactoring terminal ownership must not redesign the interactive interface.
- Design by contract: terminal safety, disposal, event ordering, and import boundaries are executable tests.

## Success criteria

### Interactive live runs

- Preserve the original step headers, colors, assistant marker, tool symbols and labels, nested-agent pipes, retry and error lines, completion boundaries, waiting spinner, and status bar.
- Render `text_delta` immediately, before `text_done`.
- Use inline differential rendering rather than the alternate screen.
- Never enter raw mode or read stdin.
- Never negotiate Kitty keyboard mode, modifyOtherKeys, bracketed paste, or image cell-size protocols.
- Filter erase-scrollback and unsupported cell-size queries from renderer writes.
- Forward terminal dimensions and resize events to the renderer.
- Use one reporter-owned animation interval. Components own no timers.
- Keep spinner updates in the existing live line rather than appending records.
- Restore the cursor and remove resize and exception listeners exactly once.
- Flush the final public `pi-tui` render queue before awaited disposal.
- Contain output sink failures so presentation cannot replace the run result.
- Ctrl+C, SIGTERM, and SIGHUP request cancellation through process signals.

### Redirected live runs

- Do not construct a TUI.
- Emit no ANSI, cursor, screen, scrollback, alternate-screen, synchronized-output, or protocol controls.
- Print completed assistant blocks, tools, retries, errors, interruption, and summaries as plain records.
- Bound tool previews but preserve assistant text.
- Contain sink failures and make disposal idempotent.

### Session browser

- Enter an alternate screen before rendering.
- Own raw input and an internal fixed-height viewport.
- Support line, page, start, end, open, back, delete-lock, exit, and resume actions.
- Preserve a stable history anchor across resize.
- Render no animation.
- Filter erase-scrollback and unsupported cell-size queries.
- Restore raw mode, cursor, listeners, and alternate screen before returning a result.
- Dispose the browser before creating a resumed live reporter.

### Architecture

- `src/lib/` and `src/agents/` do not depend on presentation implementations.
- `src/output/` does not depend on commands or TUI code.
- `src/tui/` does not depend on commands or output code.
- Commands compose output and TUI implementations.
- Only `src/tui/` imports `@mariozechner/pi-tui`.
- Production code never imports `src/testing/`.
- Dependency cycles and unresolved imports fail `bun run check`.
- Raw terminal controls are defined only in `src/lib/ansi.ts`.

## Non-goals

- Do not merge live execution and session browsing into one TUI lifecycle.
- Do not restore `ProcessTerminal`.
- Do not restore raw-input Ctrl+C handling for live runs.
- Do not add mouse tracking.
- Do not add animation to the browser or redirected reporter.
- Do not redesign persistence or resume boundaries.
- Do not introduce another domain event hierarchy.
- Do not restore the removed public `createLoopTUI` imperative API.

## Dependency graph

```text
src/agents/        agent adapters and process integration
      │
      ▼
src/lib/           events, persistence, runner, shared contracts
      ▲
      │
src/commands/      orchestration and presentation selection
   │           │
   ▼           ▼
src/output/     src/tui/
redirected      interactive live renderer
reporting       and session browser
```

Allowed presentation dependencies:

```text
output -> lib and agents/types
  tui  -> lib, agents/types, and pi-tui
commands -> lib, agents, output, and tui
```

Disallowed lateral dependencies:

```text
output -X-> tui
tui    -X-> output
agents -X-> output or tui
lib    -X-> output or tui
```

## Module structure

```text
src/
  lib/
    run-reporter.ts
    session-event.ts
    session-event-store.ts
    format.ts
    ansi.ts

  output/
    run-reporter.ts
    console-run-format.ts
    console-run-reporter.ts

  tui/
    live-run-reporter.ts
    run-event-projector.ts
    safe-live-output.ts
    inline-terminal-session.ts
    run-view.ts
    event-router.ts
    event-handlers.ts
    thinking-indicators.ts
    formatters.ts
    step-display.ts
    components/
      thinking-indicator.ts
      status-bar.ts
      pipe-box.ts
      run-boundary.ts
      separator.ts
    terminal-session.ts
    session-browser/
      index.ts
      model.ts
      timeline.ts
      view.ts

  commands/
    run-reporter.ts
    process-run-output.ts
    shutdown-signals.ts
    execute-session.ts
    run-command.ts
    resume-command.ts
```

## Core contracts

### Run reporter

```ts
export interface RunReporter extends Disposable, AsyncDisposable {
  report(event: SessionEvent): void
  replay?(events: readonly SessionEvent[]): void
}
```

Contract:

- `report()` is synchronous and preserves event order.
- `replay()` rebuilds interactive presentation from stored event order when supported.
- Redirected reporters omit `replay()` so prior output is not printed again.
- Reporters contain presentation sink failures.
- Report after disposal is a no-op.
- Synchronous disposal is idempotent and provides emergency cleanup.
- Awaited disposal flushes queued terminal rendering before releasing ownership.
- The command that creates a reporter owns it with `await using`.
- Child-process shutdown is not part of reporter disposal.

### Run output

```ts
export interface RunOutput {
  readonly isTTY: boolean
  readonly columns?: number
  readonly rows?: number
  write(text: string): void
  on?(event: "resize", listener: () => void): unknown
  off?(event: "resize", listener: () => void): unknown
}
```

The CLI adapts `process.stdout` to this injected contract. Presentation modules do not access `process.stdout` directly.

### Inline terminal session

```ts
export interface InlineTerminalSession extends Disposable {
  readonly tui: TUI
  readonly terminal: Terminal
}
```

Contract:

- Use a narrow output-only `Terminal` adapter.
- Do not enter alternate screen or raw mode.
- Register only stdout resize and exception-monitor listeners.
- Filter erase-scrollback and image cell-size query controls.
- Roll back partially acquired resources if TUI startup throws.
- Dispose synchronously, idempotently, and best effort.

### Browser terminal session

```ts
export interface TerminalSession extends Disposable {
  readonly tui: TUI
  readonly terminal: Terminal
}
```

Contract:

- Enter alternate screen before TUI startup.
- Own raw input through `StdinBuffer` and stdout resize.
- Do not negotiate keyboard or paste protocols.
- Filter erase-scrollback and image cell-size queries.
- Stop TUI before leaving alternate screen.
- Restore through an exception monitor on uncaught render failure.

### Process signals

```ts
export interface ShutdownSignals extends Disposable {
  readonly signal: AbortSignal
  readonly exitCode: number | undefined
}
```

Expected exit codes:

- SIGINT: 130
- SIGHUP: 129
- SIGTERM: 143

## Interactive event policy

| Session event | Live behavior |
| --- | --- |
| `session_created` | Remember invocation and show session identifier |
| `step_started` | Remember the step |
| `step_iteration_started` | Render the original two-line step header and start waiting |
| `agent_event/session_start` | Update model metadata in the active header |
| `agent_event/text_delta` | Stream into the active assistant block and remove waiting |
| `agent_event/text_done` | Close the block and show thinking state |
| `agent_event/tool_start` | Render the original tool line or nested agent pipe |
| `agent_event/tool_done` | Restore waiting for the parent |
| `agent_event/task_started` | Create a nested agent container when needed |
| `agent_event/task_done` | Close the nested pipe with status, summary, duration, and tokens |
| `agent_event/retry` | Render the original retry line |
| `agent_event/error` | Render the original error line |
| `agent_event/usage_update` | Update current usage and cost status |
| `agent_usage_updated` | Store authoritative execution totals |
| `agent_session_completed` | Render the original completion boundary |
| `step_cancelled` / `attempt_aborted` | Render interruption once and hide status |
| `run_completed` | Render the total loop summary and hide status |

On resume, execution gives a replay-capable interactive reporter the complete persisted event sequence before recording the new attempt. The shared `RunEventProjector` rebuilds the original component hierarchy from those events, then applies new events incrementally. Redirected reporters receive only `session_created` and prior authoritative usage snapshots, so old plain output is not printed again. Replay events are never persisted again.

## Animation and cleanup

- `ThinkingIndicator` computes its frame from elapsed time but owns no timer.
- `StatusBar` computes duration during render but owns no timer.
- `LiveRunReporter` owns one 120 ms clock that requests differential rendering.
- Event-driven renders and clock renders are coalesced by `pi-tui`.
- Awaited disposal stops the clock, removes indicators, hides status, requests a final render, waits one next-tick turn, and then stops the inline terminal session.
- Synchronous disposal skips the flush but still restores resources. It is used by emergency and compatibility paths.
- No private `TUI.doRender()` access is allowed.

## Terminal safety

All raw controls are centralized in `src/lib/ansi.ts`.

Interactive live output may contain:

- SGR styles
- synchronized-output markers generated by `pi-tui`
- cursor movement
- line and visible-screen clearing required for differential rendering
- cursor hide and show

Interactive live output must not contain:

- alternate-screen controls
- erase-scrollback
- keyboard protocol negotiation
- modifyOtherKeys
- bracketed paste mode
- image cell-size queries

Redirected output must contain none of the controls above, including SGR styles.

The live renderer deliberately rewrites a bottom terminal region. This is how Pi-style animation coexists with scrollback. Most terminal emulators keep a manually scrolled viewport stable when existing lines change. An emulator configured to follow every output write may still return to the bottom while animation is active.

## Browser design

The browser remains Model-Update-View:

```ts
type BrowserModel = {
  mode: "overview" | "detail"
  sessions: SessionOverview[]
  selectedIndex: number
  detail?: {
    session: SessionOverview
    content: SessionBrowserDetail
    viewport: HistoryViewport
    confirmDelete: boolean
  }
}
```

The model contains no components, timers, process handles, callbacks, or terminal references. Timeline projection rebuilds a read-only `RunEventProjector` from immutable events, so browser history uses the same visual components and formatting as live output. It carries a stable transcript anchor, renders no more than the current terminal row count, and stabilizes the viewport across resize.

## Verification strategy

### Unit and integration

- Original formatter, event router, nested-agent, status, spinner, and width tests remain active.
- Live reporter tests assert original headers, immediate text deltas, spinner, completion, summary, usage accounting, sink failure containment, and awaited final flushing.
- Inline terminal tests assert no alternate screen, resize forwarding, scrollback/query filtering, rollback, and idempotent cleanup.
- Redirected reporter tests assert plain stable output, deduplication, and bounded previews.
- Execution tests assert persisted event order, complete interactive replay, and redirected resume context.
- Browser tests cover model transitions, shared live-format projection, semantic styling, viewport anchoring, terminal ordering, and sequential resume.
- Architecture tests and dependency-cruiser enforce layer boundaries.
- The built CLI smoke test protects `using` and `await using` transformation for Node.

### Manual PTY matrix

1. Start a slow interactive run.
2. Confirm assistant text appears before the response completes.
3. Confirm the original header, tool formatting, nested pipes, spinner, completion, and status bar.
4. Scroll several screens upward while the spinner runs.
5. Confirm spinner ticks do not append new history lines.
6. Zoom in and out and resize at narrow and wide widths.
7. Confirm earlier shell and run scrollback is not erased.
8. Redirect a run to a file and inspect it for escape bytes.
9. Open and navigate a long session history.
10. Resize while anchored in the middle of browser history.
11. Exit the browser and verify terminal modes and shell scrollback.
12. Resume and confirm browser restoration happens before live rendering.
13. Send SIGINT, SIGTERM, and SIGHUP to slow runs.
14. Verify child exit, lock release, exit code, cursor visibility, and `stty -g` restoration.

## Failure policy

- Persistence failures remain best effort under the existing storage policy.
- Reporter sink failures disable further writes but do not stop execution.
- TUI startup failures roll back acquired terminal resources before surfacing.
- Browser loading errors stay visible without mutating session data.
- Cleanup failures do not replace the primary command result.
- Runner cancellation waits for child shutdown before lock release.
- Exception monitors restore terminal state but do not consume uncaught errors.

## Completion checklist

- [x] ADR 0003 records separate inline, redirected, and browser lifecycles
- [x] ADR 0002 links to the corrected presentation decision
- [x] dependency-cruiser runs as part of `bun run check`
- [x] Session event schema is separate from filesystem storage
- [x] `RunReporter` supports idempotent synchronous and awaited disposal
- [x] Execution reports persisted events without importing TUI code
- [x] Interactive resume replays complete stored history through the shared event projector
- [x] Redirected resume receives context without duplicating prior output
- [x] TTY runs select the inline live reporter
- [x] Redirected runs select the plain console reporter
- [x] Original live visual components and formatting are preserved
- [x] Assistant `text_delta` events render immediately
- [x] One reporter-owned clock drives spinner and status rendering
- [x] Components own no animation timers
- [x] Inline live rendering never enters raw or alternate-screen mode
- [x] Browser terminal ownership remains isolated and idempotent
- [x] Erase-scrollback and unsupported cell-size queries are filtered
- [x] Browser follows Model-Update-View with a fixed-height viewport
- [x] Browser history and live output use the same event-to-component projection
- [x] Browser overview and detail use semantic ANSI styling
- [x] Browser scope ends before resumed live execution starts
- [x] Live cancellation uses process signals rather than raw stdin
- [x] Private `doRender()` access is absent
- [x] Public legacy `LoopTUI` exports remain removed and documented
- [x] Full automated check passes after the corrected refactor
- [x] tmux PTY confirms spinner, pre-completion deltas, completion, and final summary
- [x] tmux PTY confirms a scrolled viewport stays off the bottom during animation and survives resize
- [x] PTY transcript contains no alternate-screen, erase-scrollback, or cell-size-query controls
- [x] tmux PTY confirms live-format browser history and old transcript replay before new streaming
- [ ] Emulator-specific zoom plus manual signal cleanup matrix passes
