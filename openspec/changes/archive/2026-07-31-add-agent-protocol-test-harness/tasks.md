## 1. Characterize Existing Boundaries

- [x] 1.1 Add or tighten focused tests that characterize provider argument construction, raw stream parsing, process-result validation, abort behavior, and application session outcomes before refactoring composition.
- [x] 1.2 Identify broad tests to migrate, narrow tests to retain, and observable behaviors that must remain covered during the rewrite.

## 2. Extract Application Dependencies

- [x] 2.1 Add failing tests showing the application workflow can receive scoped technical dependencies without mutating global environment state.
- [x] 2.2 Introduce a cohesive application dependency bundle and move production defaults into the CLI composition root without changing user-facing behavior.
- [x] 2.3 Refactor application execution so tests can invoke real configuration, agent selection, runner, persistence, reporting, and cleanup logic in-process.
- [x] 2.4 Verify the production CLI still wires the existing filesystem, terminal, clock, and process implementations.

## 3. Inject the Agent Process Boundary

- [x] 3.1 Define a process-spawning contract containing spawn input, readable stdout, process result, running state, and abort behavior currently required by Pi and Claude adapters.
- [x] 3.2 Add failing adapter tests using a minimal injected process boundary that emits raw provider bytes.
- [x] 3.3 Refactor the agent factory and Pi and Claude adapters to receive process spawning through dependencies while preserving production argument, parsing, completion, and cancellation behavior.
- [x] 3.4 Keep `spawnChildProcess()` as the production implementation and preserve focused real-subprocess tests for OS-owned lifecycle behavior.

## 4. Build the Stateful Process Fake

- [x] 4.1 Add failing tests for queued runs, invocation recording, stdout chunks, stderr, exit code, signal, spawn failure, running state, abort recording, and deferred completion.
- [x] 4.2 Implement the in-memory fake process spawner and fake process handle using controlled readable streams and deferred results.
- [x] 4.3 Add strict diagnostics for unexpected invocations, unconsumed required runs, invalid lifecycle transitions, and leaked running work.
- [x] 4.4 Add named checkpoint and release operations that synchronize interruption tests without arbitrary sleeps.
- [x] 4.5 Add disposal behavior that completes or aborts owned fake processes and reports leaked scenarios or resources.

## 5. Build Provider-Specific Scenario APIs

- [x] 5.1 Add failing Pi scenario tests for session initialization, text, tools, retry, usage, completion, stderr, failure, multiple runs, and invocation inspection.
- [x] 5.2 Implement the Pi scenario builder so semantic operations serialize supported raw Pi JSON records into the fake stdout stream.
- [x] 5.3 Add failing Claude scenario tests for initialization, text streaming, tools, subagents, retry, usage, completion, stderr, failure, multiple runs, and invocation inspection.
- [x] 5.4 Implement the Claude scenario builder so semantic operations serialize supported raw Claude stream-json records into the fake stdout stream.
- [x] 5.5 Add `raw()` and `rawChunks()` escape hatches for each provider and verify malformed bytes and explicit chunk boundaries reach production parsers unchanged.
- [x] 5.6 Anchor semantic builder output against representative captured provider examples and production parser contracts to detect protocol drift.

## 6. Build the In-Process Application Harness

- [x] 6.1 Add failing harness tests for unique project, config, and state roots, captured terminal I/O, scoped environments, concurrent isolation, and automatic cleanup.
- [x] 6.2 Implement `setupLoopTest()` with production application execution, isolated real filesystem roots, provider fakes, captured terminal boundaries, and explicit resource management.
- [x] 6.3 Add semantic project configuration and workflow operations for tasks, repeats, until loops, recipes, resume, and interruption without bypassing production validation or orchestration.
- [x] 6.4 Add inspectors for application results, stdout, stderr, persisted session metadata, lifecycle events, usage, locks, provider invocations, scenario consumption, and owned resources.
- [x] 6.5 Verify harness failures include arranged scenario, invocation, checkpoint, persisted state, output, and resource diagnostics needed to debug the test.

## 7. Prove Nearly End-to-End Behavior

- [x] 7.1 Add successful Pi and Claude application tests that exercise production adapters, parsers, runner, persistence, reporting, and cleanup.
- [x] 7.2 Add multi-iteration and sequential-step tests proving queued provider runs are consumed by real runner behavior and prior summaries flow into later prompts.
- [x] 7.3 Add provider failure tests covering malformed output, premature stdout completion, stderr, nonzero exit, spawn errors, retries, and completion followed by process failure.
- [x] 7.4 Add deterministic interruption tests that pause at fake checkpoints, invoke real cancellation behavior, and verify persisted abort state, process abort requests, lock cleanup, and exit status.
- [x] 7.5 Add resume tests that arrange persisted sessions, invoke real resume behavior, consume new provider scenarios, and inspect the final session event history.
- [x] 7.6 Add concurrent and repeated harness runs to verify deterministic ordering, isolation, and cleanup.

## 8. Rewrite and Simplify the Test Suite

- [x] 8.1 Migrate broad runner and command behavior tests to the application harness where they gain real provider parsing, persistence, reporting, or lifecycle coverage.
- [x] 8.2 Replace generated fake-executable and sleep-based integration tests with stateful fake-process scenarios and checkpoints.
- [x] 8.3 Migrate relevant TUI and output workflow tests to captured terminal boundaries while retaining focused rendering and formatter tests.
- [x] 8.4 Remove or reduce the normalized `createStubAdapter()`, reusable normalized scenarios, duplicated temporary-directory helpers, and superseded test setup after equivalent coverage exists.
- [x] 8.5 Retain focused pure parser, reducer, path, formatting, architecture, real-subprocess contract, CLI argument, and built-artifact smoke tests where they remain the narrowest realistic scope.

## 9. Documentation and Verification

- [x] 9.1 Document the arrange-act-inspect harness API, provider scenario vocabulary, raw escape hatches, checkpoint lifecycle, cleanup rules, and guidance for choosing harness versus focused tests.
- [x] 9.2 Document how provider builders are checked against representative real output and how maintainers update those contract anchors safely.
- [x] 9.3 Run harness suites repeatedly and concurrently to detect nondeterminism or leaked resources.
- [x] 9.4 Run `bun run check`, inspect any formatter changes, and verify the built CLI smoke test still exercises the production composition root.
