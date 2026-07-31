# Application test harness

Use `setupLoopTest()` for behavior that spans provider parsing, runner orchestration, persistence, reporting, resume, or cancellation. Keep focused tests for pure parsers, reducers, formatting, paths, CLI arguments, and the real child-process contract.

```ts
await using loop = await setupLoopTest();
loop.agent("pi").givenRun((pi) =>
  pi
    .session({ model: "pi-test" })
    .text("Implemented")
    .complete({ result: "Implemented" }),
);

const result = await loop.run("Fix the bug", { agent: "pi" });

expect(result.exitCode).toBe(0);
expect(loop.session.latest()?.aggregate.status).toBe("completed");
expect(loop.agent("pi").invocations()).toHaveLength(1);
```

## Arrange

Each provider owns a queue of required runs. One real adapter spawn consumes one run.

Pi scenarios support:

- `session()`, `text()`, `tool()`, `retry()`, `usage()`, `complete()`, and `fail()`
- `stderr()`, `exit()`, `spawnError()`, `deferred()`, and `optional()`
- `raw()`, `rawChunks()`, and `checkpoint()`

Claude scenarios provide the same transport and lifecycle operations, plus provider-specific `subagent()` behavior. Their semantic operations serialize Pi JSON or Claude stream-json records. They never create normalized `AgentEvent` values.

Use `raw()` for malformed or unknown protocol data. Use `rawChunks()` when exact stream boundaries matter.

## Act

- `run(task, { agent, repeat, until, max })`
- `runSteps(steps, { agent })`
- `writeRecipe(name, yaml)` and `runRecipe(name, args)`
- `resume(sessionDir)`
- Start `run()` without awaiting it, wait for a provider checkpoint, then call `interrupt()` for deterministic cancellation tests

```ts
loop.agent("pi").givenRun((pi) =>
  pi.text("working").checkpoint("running").complete({ result: "late" }),
);
const running = loop.run("Work", { agent: "pi" });
await loop.agent("pi").waitForCheckpoint("running");
loop.interrupt();
expect((await running).exitCode).toBe(130);
```

Checkpoints are in-memory synchronization points. Do not use sleeps to coordinate harness tests.

## Inspect

A run returns its exit code and captured stdout and stderr. The harness also exposes:

- persisted session records, lifecycle events, aggregate usage, and lock state
- provider invocations including command, arguments, cwd, and environment
- fake process running and abort state
- queued scenarios and owned resource counts
- `diagnostics()` with roots, invocations, persisted state, output, and resources

Each harness owns unique project, config, and state roots. Async disposal aborts leaked work, reports unconsumed scenarios, and removes all roots. Prefer `await using` so cleanup also runs when assertions fail.

## Protocol contract anchors

Provider builders are checked in two ways:

1. Builder output runs through the production adapters and parsers in `src/testing/provider-scenarios.spec.ts`.
2. Claude shapes are compared with representative records in `examples/claude/subagent.jsonl`. Pi shapes are anchored against focused parser examples in `src/agents/pi/pi.spec.ts`.

When provider output changes:

1. Capture a minimal redacted real record. Keep ordering and fields used by production parsing.
2. Update the provider protocol types and focused parser tests first.
3. Update the semantic builder to emit the supported shape.
4. Run provider scenario tests and application harness tests.
5. Keep raw escape hatches unchanged so malformed and forward-compatible cases remain expressible.
