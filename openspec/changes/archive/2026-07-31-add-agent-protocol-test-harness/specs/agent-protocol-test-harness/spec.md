## Purpose

Provide deterministic, nearly end-to-end testing that runs real Loop application behavior while replacing only controlled technical boundaries with stateful fakes.

## ADDED Requirements

### Requirement: Real application workflow
The harness SHALL run Loop's real configuration, agent selection, provider adapter, protocol parsing, orchestration, persistence, reporting, and cleanup logic in-process.

#### Scenario: Pi application workflow
- **WHEN** a test runs a task with a configured Pi scenario
- **THEN** raw Pi protocol data passes through the production Pi adapter and the resulting workflow is processed and persisted by real Loop application logic

#### Scenario: Claude application workflow
- **WHEN** a test runs a task with a configured Claude scenario
- **THEN** raw Claude protocol data passes through the production Claude adapter and the resulting workflow is processed and persisted by real Loop application logic

### Requirement: Technical boundaries only
The harness SHALL replace only technical boundaries needed to control external processes, terminal interaction, time, or environment-specific resources and SHALL NOT replace product parsing, validation, orchestration, persistence, or reporting behavior.

#### Scenario: Fake agent process boundary
- **WHEN** a harness workflow starts an agent
- **THEN** the production adapter invokes a fake process boundary while all downstream Loop behavior remains real

#### Scenario: Isolated persistent state
- **WHEN** a harness workflow writes configuration or session state
- **THEN** production filesystem behavior operates against unique harness-owned roots rather than an in-memory replacement for Loop persistence

### Requirement: Stateful provider fakes
The harness SHALL provide separate Pi and Claude fakes that queue agent runs, record process invocations, and emit protocol data matching their provider's supported raw output shapes.

#### Scenario: Multiple loop iterations
- **WHEN** a test queues multiple provider runs and Loop starts multiple agent sessions
- **THEN** the fake consumes one queued run per invocation and records the command, arguments, working directory, and scoped environment for each invocation

#### Scenario: Missing queued run
- **WHEN** Loop starts more agent sessions than the test arranged
- **THEN** the harness fails with a diagnostic that identifies the unexpected invocation and remaining scenario state

### Requirement: Semantic provider scenarios
Each provider fake SHALL offer semantic scenario operations for its supported text, tool, subagent, retry, usage, completion, failure, stderr, exit, and lifecycle behavior, and those operations SHALL generate raw provider protocol data rather than normalized Loop events.

#### Scenario: Arrange Pi completion
- **WHEN** a test arranges Pi text and successful completion through the Pi scenario API
- **THEN** the fake emits Pi JSON protocol records that the production Pi parser converts into Loop behavior

#### Scenario: Arrange Claude tool activity
- **WHEN** a test arranges Claude text, tool activity, and completion through the Claude scenario API
- **THEN** the fake emits Claude stream-json records that the production Claude parser converts into Loop behavior

### Requirement: Raw protocol escape hatches
Provider scenarios SHALL support exact raw output and explicitly split raw output chunks without interpreting them as normalized Loop events.

#### Scenario: Malformed protocol data
- **WHEN** a test adds malformed raw provider output
- **THEN** the malformed bytes reach the production stream parser unchanged and the workflow exposes the resulting failure

#### Scenario: Split protocol record
- **WHEN** a test divides one provider record across multiple raw chunks
- **THEN** the fake stream preserves those chunk boundaries and the production stream reader processes them

### Requirement: Controllable lifecycle
The process fake SHALL deterministically model running state, stdout completion, stderr, exit status, abort requests, and test-controlled checkpoints.

#### Scenario: Interrupt after a checkpoint
- **WHEN** a test waits for a named provider checkpoint and interrupts the running workflow
- **THEN** the real runner and adapter cancellation path executes without an arbitrary synchronization sleep

#### Scenario: Process failure after completion output
- **WHEN** the fake emits a provider completion record and then resolves with a nonzero exit and stderr
- **THEN** the production adapter rejects the completion according to its real process-result handling

### Requirement: Isolated harness lifecycle
Each harness instance SHALL own unique project, configuration, state, terminal, and fake-boundary state and SHALL be safe to run concurrently with other instances.

#### Scenario: Concurrent harnesses
- **WHEN** multiple harness instances run concurrently
- **THEN** their files, provider scenarios, invocations, output, clocks, and lifecycle controls do not interfere

#### Scenario: Harness disposal
- **WHEN** a test completes or fails
- **THEN** harness disposal finishes or aborts owned work and removes owned temporary resources

### Requirement: Observable outcomes
The harness SHALL expose application results through user-visible output and persistent or boundary state rather than internal mock call counts.

#### Scenario: Inspect successful workflow
- **WHEN** a harness workflow completes
- **THEN** the test can inspect exit status, stdout, stderr, session metadata, lifecycle events, usage, agent invocations, and lock cleanup

#### Scenario: Inspect interrupted workflow
- **WHEN** a harness workflow is interrupted
- **THEN** the test can inspect the persisted interruption outcome, process abort state, resource cleanup, and final exit status

### Requirement: Offline deterministic execution
Harness workflows SHALL require no installed provider executable, credentials, or network access and SHALL produce deterministic ordering and outcomes for the same arranged scenario.

#### Scenario: Provider unavailable on host
- **WHEN** neither Pi nor Claude is installed on the test host
- **THEN** harness workflows execute through the injected provider fakes

#### Scenario: Repeat scenario
- **WHEN** the same scenario runs repeatedly
- **THEN** its provider output ordering and asserted application outcomes remain equivalent

### Requirement: Real process contract coverage
Behavior owned solely by the production operating-system process implementation SHALL be verified by a focused real-subprocess contract suite rather than simulated as application behavior.

#### Scenario: Process implementation contract
- **WHEN** production process behavior such as force termination or inherited stream cleanup must be verified
- **THEN** a focused contract test uses a real local child process without invoking Pi, Claude, credentials, or network access
