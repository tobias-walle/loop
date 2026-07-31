## Context

Loop currently constructs important technical dependencies inside production workflows:

- Pi and Claude adapters call `spawnChildProcess()` directly.
- `executeSession()` creates the configured agent before constructing the runner.
- CLI integration tests launch Loop and generated fake-agent executables as operating-system processes.
- Runner tests often inject `createStubAdapter()`, which emits normalized `AgentEvent` objects and bypasses provider parsing.

The desired harness sits between these approaches. It runs nearly all Loop behavior in-process while replacing only boundaries that leave or depend on the test environment. See `proposal.md` for motivation and `specs/agent-protocol-test-harness/spec.md` for required behavior.

## Goals / Non-Goals

**Goals:**

- Make a stateful application harness the easiest way to test behavior spanning multiple Loop layers.
- Feed raw Pi and Claude protocol bytes through production adapters and parsers.
- Keep real configuration, orchestration, persistence, reporting, and cleanup behavior.
- Make provider scenarios concise while preserving access to malformed and chunked raw data.
- Support deterministic cancellation and lifecycle tests without wall-clock sleeps.
- Allow broad refactoring and test replacement where current construction prevents clean boundary control.

**Non-Goals:**

- Run the Loop CLI, Pi, or Claude as an operating-system process in normal harness tests.
- Replace production filesystem persistence with an in-memory store.
- Force Pi and Claude into one provider-neutral protocol model.
- Reproduce product parsing, orchestration, or persistence inside the harness.
- Eliminate focused pure tests or real local subprocess contract tests where they are the narrowest valid scope.
- Verify live provider compatibility during the normal test suite.

## Decisions

### Run the application in-process through an explicit composition boundary

Production construction will be refactored so the application workflow receives a dependency bundle from a composition root. The real CLI supplies production dependencies. The test harness supplies controlled technical boundaries and otherwise invokes the same application workflow.

```text
Production CLI                      Test
      │                               │
      ▼                               ▼
production composition root     setupLoopTest()
      │                               │
      └──────────┬────────────────────┘
                 ▼
         real application workflow
                 │
     ┌───────────┼───────────────┐
     ▼           ▼               ▼
 real config  real sessions   real reporting
     │           │               │
     └───────────┼───────────────┘
                 ▼
       real provider adapter
                 │
                 ▼
       injected process boundary
```

The application boundary should accept dependencies rather than test flags. Production defaults remain in the composition root, not inside business workflows.

Alternative considered: run the complete CLI as a subprocess. Rejected because it makes scenario setup, synchronization, output inspection, and cleanup slower and more complex while adding little confidence outside focused CLI entry-point tests.

### Inject process creation below production provider adapters

Introduce a process-spawning interface compatible with the information currently used from `ChildProcessHandle`:

- stdout as a readable byte stream
- process result containing exit code, signal, stderr, and spawn error
- running state
- abort behavior
- command, arguments, working directory, and environment as spawn input

Pi and Claude adapters receive this dependency and continue to own argument construction, stream parsing, provider event mapping, completion validation, and adapter-level cancellation.

The production implementation delegates to `spawnChildProcess()`. The harness implementation returns a stateful fake handle backed by controlled streams and deferred results.

Alternative considered: inject `AgentAdapter` into the application harness. Rejected because it would let broad tests bypass the provider parsers and process-result handling that the harness exists to exercise. Direct adapter injection may remain available to narrow runner tests outside the application harness.

### Use stateful, provider-specific fakes

The harness exposes separate Pi and Claude fakes. Each fake queues complete agent runs. Every production spawn consumes one queued run and records its invocation.

```text
loop.pi
  .givenRun(firstPiScenario)
  .givenRun(secondPiScenario)

real runner iteration 1 → production Pi adapter → fake spawn 1
real runner iteration 2 → production Pi adapter → fake spawn 2
```

An unexpected spawn fails with diagnostics containing the provider, command, arguments, prior invocations, and remaining queue. Disposal also fails when required scenarios were not consumed unless the test explicitly marks them optional.

Provider APIs remain separate because equivalent concepts have different raw event sequences and metadata in Pi and Claude.

Alternative considered: one shared fake-agent DSL. Rejected because it would hide meaningful provider differences and evolve into a second normalized event model.

### Offer semantic builders that produce raw protocol bytes

Common scenarios use fluent provider-specific vocabulary. For example:

```ts
loop.pi.givenRun((pi) =>
  pi.text("Implemented the fix").complete({
    result: "Implemented the fix\n\nLOOP_DONE",
    usage: { input: 100, output: 20, cost: 0.04 },
  }),
);
```

The Pi builder expands this into Pi JSON records. The Claude builder expands its vocabulary into Claude stream-json records. Both serialize their provider records into the fake stdout stream. They never construct normalized `AgentEvent` objects.

Builders should use provider protocol types shared with parser inputs where practical. Representative parser tests and captured examples provide contract anchors for the generated shapes, but captured transcript replay is not the primary scenario model.

Alternative considered: checked-in raw transcripts as the primary harness API. Rejected because they make scenario intent, dynamic values, multi-run workflows, and lifecycle control cumbersome.

### Preserve raw and transport-level escape hatches

Each provider scenario supports:

- `raw()` for exact output bytes
- `rawChunks()` for explicit chunk boundaries
- stderr content
- exit code, signal, and spawn error
- stdout ending before completion
- process completion after provider completion

Semantic and raw operations can be combined in one scenario. Raw bytes bypass semantic validation so tests can express malformed and unknown provider input.

Protocol content and transport behavior remain distinct internally. A valid semantic scenario can therefore be replayed with unusual chunk boundaries without rewriting its logical events.

### Synchronize lifecycle behavior in memory

Because the application and fake process boundary run in one process, named checkpoints use deferred promises rather than filesystem markers or timed sleeps.

```text
fake emits configured output
          │
          ▼
fake reaches checkpoint and pauses
          │
          ▼
test observes checkpoint
          │
          ▼
test interrupts or releases workflow
```

The fake records abort requests and controls when its result resolves. Time-dependent application behavior receives a scoped controllable clock only where production code owns the timing decision.

Behavior hidden inside the real Execa implementation, such as actual OS signal delivery and descendant-held stream cleanup, remains covered by focused real-subprocess contract tests. If graceful-to-force escalation must become application-observable, that lifecycle policy must first move above the process implementation boundary.

Alternative considered: filesystem checkpoints between fake executables and tests. Rejected because no separate fake executable exists in the in-process architecture.

### Use real isolated persistence and fake terminal boundaries

Each harness receives unique platform-aware project, config, and state roots. Production filesystem code reads and writes those roots. This keeps persistence behavior real while making tests parallel-safe.

Terminal input and output are technical boundaries. The harness supplies captured input and output implementations so tests can inspect user-visible behavior without replacing formatters, projectors, or reporters.

The harness passes scoped environment records to application construction and process spawn requests. It never mutates global `process.env`.

### Expose semantic state inspection

The public harness API follows arrange, act, inspect:

```ts
await using loop = await setupLoopTest();
loop.pi.givenRun((pi) => pi.text("done").complete({ result: "done" }));

const result = await loop.run("Do the work");

expect(result.exitCode).toBe(0);
expect(loop.session.status()).toBe("completed");
expect(loop.agent.invocations()).toHaveLength(1);
```

Inspectors read observable state:

- application exit status and captured output
- persisted session metadata and event log
- locks and owned resources
- provider spawn invocations
- fake process lifecycle and scenario consumption

They do not expose call-count assertions for internal Loop functions.

### Reshape the test suite around confidence boundaries

Broad runner, command, persistence, reporting, resume, loop, cancellation, and provider workflow behavior should move to the application harness where practical. It is acceptable to rewrite tests and refactor production composition substantially.

Focused tests remain for:

- pure parsing and formatting edge cases
- reducers and path composition
- architecture rules
- the real `spawnChildProcess()` implementation
- CLI argument parsing and a small built-entry-point smoke test

The existing normalized adapter stub may be reduced or removed if the harness makes it redundant. It is not a required compatibility surface.

## Risks / Trade-offs

- [The provider builders can drift from real Pi or Claude protocols] → Share provider input types where practical and anchor builders with captured examples and production parser contract tests.
- [Injecting boundaries can spread dependency plumbing across production code] → Keep defaults in a small composition root and pass cohesive dependency objects at application boundaries.
- [A large test rewrite can temporarily reduce confidence] → Migrate behavior in vertical slices and compare observable coverage before removing old tests.
- [The harness can become a second application framework] → Keep its API limited to arranging boundaries, invoking real workflows, and inspecting outcomes.
- [Provider-specific builders duplicate some fixture vocabulary] → Share transport and lifecycle infrastructure while keeping protocol construction explicitly provider-specific.
- [In-process tests cannot prove OS signal delivery] → Preserve focused real-subprocess contract tests for behavior owned by the production process implementation.
- [Real filesystem persistence is slower than in-memory state] → Use unique small temporary roots and reserve pure tests for isolated storage transformations.
- [Automatic scenario-consumption checks can conflict with intentional interruption] → Support explicitly optional or cancellable queued runs while keeping strict consumption as the default.

## Migration Plan

1. Characterize current application, adapter, and subprocess behavior with focused tests before moving construction boundaries.
2. Introduce an explicit application dependency bundle and keep the production CLI wired to existing implementations.
3. Inject process spawning through agent factory and provider adapters without changing production behavior.
4. Build the stateful fake process handle, invocation recording, streams, deferred results, checkpoints, and disposal.
5. Build provider-specific Pi and Claude scenario APIs with semantic operations and raw escape hatches.
6. Build `setupLoopTest()` around isolated real storage roots, captured terminal boundaries, production application execution, and semantic inspectors.
7. Migrate behavior in vertical slices, starting with success, failure, loops, resume, and interruption for both providers.
8. Rewrite or remove superseded stub, generated-script, sleep-based, and duplicated setup tests after equivalent harness coverage exists.
9. Retain and clarify focused parser, process contract, CLI parser, architecture, and built-artifact smoke tests.
10. Run the harness repeatedly and concurrently, then run the full project check before completing the change.

Rollback is test-architecture only. Production composition can continue using the same concrete dependencies while migrated tests return to narrower setup if a harness slice proves unreliable.
