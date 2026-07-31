## Why

Loop's tests either inject already-normalized `AgentEvent` objects or launch bespoke fake executables, leaving no reusable way to exercise nearly the entire application with realistic Pi and Claude protocol data. A real test harness should run Loop in-process, keep product behavior real, and fake only controlled technical boundaries.

## What Changes

- Add an in-process application test harness that runs real Loop configuration, agent selection, adapters, protocol parsing, orchestration, persistence, reporting, and cleanup behavior.
- Introduce injectable technical boundaries where production code currently constructs external processes or terminal behavior directly.
- Add stateful Pi and Claude process fakes that emit provider-specific raw protocol bytes through the same stream and lifecycle contract as a real child process.
- Provide semantic, provider-specific scenario builders for common behavior such as text, tools, subagents, retries, completion, failure, and multiple loop iterations.
- Provide raw protocol and raw chunk escape hatches for malformed input, streaming boundaries, and new provider events.
- Provide deterministic lifecycle checkpoints for interruption and cancellation tests without arbitrary sleeps.
- Expose observable results including output, persisted sessions, lifecycle events, locks, agent invocations, and resource cleanup.
- Permit broad production refactoring and test rewrites where needed to establish clean dependency boundaries and make the harness the normal choice for cross-layer behavior tests.
- Retain a small real-subprocess contract suite for behavior owned specifically by the operating-system process implementation.

## Capabilities

### New Capabilities

- `agent-protocol-test-harness`: Defines deterministic, nearly end-to-end application testing through real Loop logic and stateful Pi and Claude boundary fakes.

### Modified Capabilities

None.

## Impact

- Affects production composition and dependency injection around agent process creation, application execution, terminal output, and lifecycle control.
- Affects test infrastructure under `src/testing/` and may substantially rewrite agent, runner, command, CLI, persistence, and TUI tests.
- Builds on the existing provider parsers, `ChildProcessHandle` contract, runner, session stores, reporters, and isolated storage roots.
- Adds no user-facing CLI behavior and requires no installed Pi or Claude executable, provider credentials, or network access for harness tests.
