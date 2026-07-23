# 0003: Separate terminal presentation modes

## Status

Accepted

## Decision

Loop has three presentation paths with separate lifecycles:

1. Interactive live execution uses an inline differential renderer.
2. Redirected live execution uses append-only plain output.
3. Session navigation and history inspection use a short-lived alternate-screen terminal UI with an internal viewport.

The interactive live renderer preserves the original Loop presentation: streamed assistant text, tool symbols and labels, nested agent pipes, waiting indicators, completion boundaries, and the usage status bar. It may move the cursor and replace lines inside its live region. It does not enter raw mode or the alternate screen. It filters erase-scrollback and unsupported terminal-query controls before they reach stdout.

The live renderer uses a narrow output-only terminal adapter instead of `ProcessTerminal`. The adapter owns resize registration and cursor restoration but does not read stdin, negotiate keyboard protocols, enable bracketed paste, or create delayed protocol timers. Process signals own cancellation.

A single reporter-owned animation clock drives waiting indicators and elapsed status updates. Components do not own timers. Reporter disposal is awaited so `pi-tui` can flush its public render queue before the terminal session stops. A synchronous disposer remains as an idempotent emergency fallback.

Redirected output never constructs a TUI. It contains no ANSI or terminal mutation controls and remains suitable for files and pipelines.

The session browser retains its isolated alternate-screen lifecycle. Its terminal scope ends before a resumed live reporter is created.

All presentation modes consume the existing session event vocabulary. They do not introduce another domain event hierarchy. Browser state follows Model-Update-View. Browser history and interactive live output share one `RunEventProjector`, which applies persisted events to the original component hierarchy. The browser rebuilds a read-only transcript from stored events, while the live reporter retains the same projection and applies new events incrementally.

Following Pi coding agent's session replacement strategy, interactive resume rebuilds presentation from persisted history through the same components used for live messages. A TTY reporter replays the complete stored event sequence before resumed execution emits its new attempt. Redirected reporters do not replay old output and receive only the invocation and usage context needed for future plain summaries.

Scopes that acquire presentation resources own their disposal. Asynchronous child-process shutdown remains part of session execution rather than terminal cleanup. Dependency-cruiser prevents presentation dependencies from entering agent and core execution layers.

This decision supersedes only the sentence in [ADR 0002](0002-session-resume.md) requiring one terminal UI lifecycle for live runs and session navigation. Event-sourced resume and session ownership remain unchanged.

## Consequences

Interactive runs retain live animation and streaming while terminal scrollback remains owned by the emulator. Spinner ticks rewrite an existing line rather than appending output. Width changes can redraw the visible live region, but erase-scrollback is never forwarded.

Interactive rendering uses cursor controls by design. Terminals configured to scroll to the bottom on every output may still follow animation writes. Loop cannot override emulator policy without disabling animation.

Redirected output has different presentation mechanics but the same persisted event semantics. It prints completed semantic records rather than terminal frames.

The browser and live renderer both depend on `pi-tui` and share event-to-component projection. They do not share terminal sessions, input handling, timers, or mutable view instances.
