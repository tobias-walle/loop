import { describe, expect, test } from "bun:test";
import { createStubAdapter, type Scenario } from "../agents/stub.js";
import { SIMPLE_TEXT } from "../testing/scenarios/basic.js";
import { RALPH_LOOP_TWO_ITERS } from "../testing/scenarios/loops.js";
import { createTestRunner, runToCompletion } from "../testing/test-setup.js";
import { createRunner } from "./runner.js";
import type { Step } from "./types.js";

describe("runner", () => {
  test("single task execution", async () => {
    const steps: Step[] = [{ type: "task", task: "Describe the project" }];
    const runner = createTestRunner(SIMPLE_TEXT, steps);
    const result = await runToCompletion(runner);

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0].exitReason).toBe("done");
    expect(result.stepResults[0].iterations).toBe(1);
    expect(result.stepResults[0].result).toContain("TypeScript");
    expect(result.stepResults[0].costUsd).toBe(0.003);
    expect(result.stepResults[0].durationMs).toBe(2400);
  });

  test("sequential steps", async () => {
    const steps: Step[] = [
      { type: "task", task: "Read the file" },
      { type: "task", task: "Summarize it" },
    ];
    const scenarios: Scenario[] = [
      {
        turns: [{ text: "The file contains a parser module." }],
        cost: 0.01,
        duration: 1000,
      },
      {
        turns: [{ text: "Summary: it's a parser." }],
        cost: 0.005,
        duration: 500,
      },
    ];
    const runner = createTestRunner(scenarios, steps);
    const result = await runToCompletion(runner);

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults[0].result).toContain("parser module");
    expect(result.stepResults[1].result).toContain("parser");
    expect(result.totalCostUsd).toBe(0.015);
    expect(result.totalDurationMs).toBe(1500);
  });

  test("logs agent and custom args on step start", async () => {
    const logs: Array<{ message: string; data?: Record<string, unknown> }> = [];
    const logger = {
      debug() {},
      info(message: string, data?: Record<string, unknown>) {
        logs.push({ message, data });
      },
      warn() {},
      error() {},
    };
    const runner = createRunner(
      [{ type: "task", task: "Review", args: { "permission-mode": "bypassPermissions" } }],
      {
        agent: createStubAdapter(SIMPLE_TEXT),
        agentName: "claude",
        logger,
        projectRoot: `/tmp/loop-test-log-${Date.now()}`,
      },
    );

    await runner.run();

    expect(logs).toContainEqual({
      message: "Step execution starting",
      data: expect.objectContaining({
        agent: "claude",
        agentArgs: { "permission-mode": "bypassPermissions" },
        stepIndex: 0,
      }),
    });
  });

  test("repeat loop runs exactly N times", async () => {
    const steps: Step[] = [{ type: "task", task: "Run tests", repeat: 3 }];
    const scenarios: Scenario[] = [
      { turns: [{ text: "Iteration 1 done" }], cost: 0.01, duration: 100 },
      { turns: [{ text: "Iteration 2 done" }], cost: 0.01, duration: 100 },
      { turns: [{ text: "Iteration 3 done" }], cost: 0.01, duration: 100 },
    ];
    const runner = createTestRunner(scenarios, steps);
    const result = await runToCompletion(runner);

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0].iterations).toBe(3);
    expect(result.stepResults[0].exitReason).toBe("done");
    expect(result.stepResults[0].costUsd).toBe(0.03);
  });

  test("assigns a stable execution ID to each agent iteration", async () => {
    const eventExecutions: string[] = [];
    const completedExecutions: string[] = [];
    const runner = createRunner([{ type: "task", task: "Work", repeat: 2 }], {
      agent: createStubAdapter([
        { turns: [{ text: "one" }], cost: 0, duration: 0 },
        { turns: [{ text: "two" }], cost: 0, duration: 0 },
      ]),
      onEvent: (_event, _stepIndex, executionId) => eventExecutions.push(executionId),
      onSessionComplete: (_stepIndex, _result, executionId) =>
        completedExecutions.push(executionId),
    });

    await runner.run();

    expect(new Set(completedExecutions).size).toBe(2);
    expect(eventExecutions.every((id) => completedExecutions.includes(id))).toBe(true);
  });

  test("onSessionComplete fires after every iteration", async () => {
    const steps: Step[] = [{ type: "task", task: "Run tests", repeat: 3 }];
    const scenarios: Scenario[] = [
      { turns: [{ text: "Iteration 1 done" }], cost: 0.01, duration: 100 },
      { turns: [{ text: "Iteration 2 done" }], cost: 0.02, duration: 200 },
      { turns: [{ text: "Iteration 3 done" }], cost: 0.03, duration: 300 },
    ];
    const sessions: Array<{ stepIndex: number; iteration: number; durationMs: number }> = [];
    const runner = createRunner(steps, {
      agent: createStubAdapter(scenarios),
      projectRoot: `/tmp/loop-test-session-complete-${Date.now()}`,
      onSessionComplete(stepIndex, result) {
        sessions.push({ stepIndex, iteration: result.iteration, durationMs: result.durationMs });
      },
    });

    await runner.run();

    expect(sessions).toEqual([
      { stepIndex: 0, iteration: 1, durationMs: 100 },
      { stepIndex: 0, iteration: 2, durationMs: 200 },
      { stepIndex: 0, iteration: 3, durationMs: 300 },
    ]);
  });

  test("ralph loop stops on LOOP_DONE", async () => {
    const steps: Step[] = [{ type: "task", task: "Fix tests", until: "All tests pass" }];
    const scenarios: Scenario[] = [
      {
        turns: [{ text: "All good!\n\nLOOP_DONE" }],
        cost: 0.01,
        duration: 500,
      },
    ];
    const runner = createTestRunner(scenarios, steps);
    const result = await runToCompletion(runner);

    expect(result.success).toBe(true);
    expect(result.stepResults[0].iterations).toBe(1);
    expect(result.stepResults[0].exitReason).toBe("loop_done");
  });

  test("ralph loop with LOOP_CONTINUE then LOOP_DONE", async () => {
    const steps: Step[] = [{ type: "task", task: "Fix tests", until: "All tests pass" }];
    const runner = createTestRunner(RALPH_LOOP_TWO_ITERS, steps);
    const result = await runToCompletion(runner);

    expect(result.success).toBe(true);
    expect(result.stepResults[0].iterations).toBe(2);
    expect(result.stepResults[0].exitReason).toBe("loop_done");
    expect(result.stepResults[0].costUsd).toBe(0.026);
  });

  test("ralph loop with --max cap", async () => {
    const steps: Step[] = [{ type: "task", task: "Fix tests", until: "All tests pass", max: 2 }];
    const scenarios: Scenario[] = [
      {
        turns: [{ text: "Still failing\n\nLOOP_CONTINUE: 3 tests still fail" }],
        cost: 0.01,
        duration: 100,
      },
      {
        turns: [{ text: "Still failing\n\nLOOP_CONTINUE: 2 tests still fail" }],
        cost: 0.01,
        duration: 100,
      },
    ];
    const runner = createTestRunner(scenarios, steps);
    const result = await runToCompletion(runner);

    expect(result.success).toBe(true);
    expect(result.stepResults[0].iterations).toBe(2);
    expect(result.stepResults[0].exitReason).toBe("max_reached");
  });

  test("group step execution", async () => {
    const steps: Step[] = [{ type: "group", tasks: ["Review code", "Fix issues"] }];
    const scenario: Scenario = {
      turns: [{ text: "Reviewed and fixed." }],
      cost: 0.02,
      duration: 3000,
    };
    const runner = createTestRunner(scenario, steps);
    const result = await runToCompletion(runner);

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0].iterations).toBe(1);
    expect(result.stepResults[0].result).toBe("Reviewed and fixed.");
  });

  test("group with --repeat", async () => {
    const steps: Step[] = [{ type: "group", tasks: ["Review", "Fix"], repeat: 2 }];
    const scenarios: Scenario[] = [
      { turns: [{ text: "Round 1 done" }], cost: 0.01, duration: 100 },
      { turns: [{ text: "Round 2 done" }], cost: 0.01, duration: 100 },
    ];
    const runner = createTestRunner(scenarios, steps);
    const result = await runToCompletion(runner);

    expect(result.success).toBe(true);
    expect(result.stepResults[0].iterations).toBe(2);
    expect(result.stepResults[0].exitReason).toBe("done");
  });

  test("group with --until", async () => {
    const steps: Step[] = [
      {
        type: "group",
        tasks: ["Review", "Fix"],
        until: "No issues",
      },
    ];
    const scenarios: Scenario[] = [
      {
        turns: [{ text: "Found issues\n\nLOOP_CONTINUE: 2 issues remain" }],
        cost: 0.01,
        duration: 100,
      },
      {
        turns: [{ text: "All clean\n\nLOOP_DONE" }],
        cost: 0.01,
        duration: 100,
      },
    ];
    const runner = createTestRunner(scenarios, steps);
    const result = await runToCompletion(runner);

    expect(result.success).toBe(true);
    expect(result.stepResults[0].iterations).toBe(2);
    expect(result.stepResults[0].exitReason).toBe("loop_done");
  });

  test("error propagation", async () => {
    const steps: Step[] = [
      { type: "task", task: "Do something" },
      { type: "task", task: "This should be skipped" },
    ];
    // We need a scenario that emits an error event.
    // The stub doesn't have built-in error support, so create a custom adapter.

    // Create a custom adapter that emits an error event
    const adapter = {
      spawn() {
        return {
          events: (async function* () {
            yield {
              type: "session_start" as const,
              model: "stub",
              sessionId: "err-1",
              tools: [],
            };
            yield { type: "error" as const, message: "Something went wrong" };
          })(),
          abort() {},
        };
      },
    };

    const runner = createRunner(steps, {
      agent: adapter,
      projectRoot: `/tmp/loop-test-error-${Date.now()}`,
    });
    const result = await runner.run();

    expect(result.success).toBe(false);
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults[0].exitReason).toBe("error");
    expect(result.stepResults[0].error).toBe("Something went wrong");
    expect(result.stepResults[1].exitReason).toBe("error");
    expect(result.stepResults[1].error).toBe("Skipped due to previous error");
  });

  test("turns adapter spawn exceptions into structured step failures", async () => {
    const events: string[] = [];
    const runner = createRunner([{ type: "task", task: "work" }], {
      agent: {
        spawn() {
          throw new Error("agent configuration failed");
        },
      },
      onEvent(event) {
        if (event.type === "error") events.push(event.message);
      },
    });

    const result = await runner.run();

    expect(result.success).toBe(false);
    expect(result.stepResults[0]).toMatchObject({
      exitReason: "error",
      error: "agent configuration failed",
    });
    expect(events).toEqual(["agent configuration failed"]);
  });

  test("turns adapter event stream exceptions into structured step failures", async () => {
    let aborted = false;
    const runner = createRunner([{ type: "task", task: "work" }], {
      agent: {
        spawn() {
          return {
            events: (async function* () {
              yield {
                type: "session_start" as const,
                model: "test",
                sessionId: "test-session",
                tools: [],
              };
              throw new Error("agent stream failed");
            })(),
            abort() {
              aborted = true;
            },
            exited: Promise.resolve(),
          };
        },
      },
    });

    const result = await runner.run();

    expect(result.success).toBe(false);
    expect(result.stepResults[0]).toMatchObject({
      exitReason: "error",
      error: "agent stream failed",
    });
    expect(aborted).toBe(true);
  });

  test("turns adapter exit exceptions into structured step failures", async () => {
    let aborted = false;
    const runner = createRunner([{ type: "task", task: "work" }], {
      agent: {
        spawn() {
          return {
            events: (async function* () {
              yield {
                type: "done" as const,
                result: "done",
                costUsd: 0,
                durationMs: 1,
                usage: { inputTokens: 0, outputTokens: 0 },
              };
            })(),
            abort() {
              aborted = true;
            },
            exited: Promise.reject(new Error("agent exit failed")),
          };
        },
      },
    });

    const result = await runner.run();

    expect(result.success).toBe(false);
    expect(result.stepResults[0]).toMatchObject({
      exitReason: "error",
      error: "agent exit failed",
    });
    expect(aborted).toBe(true);
  });

  test("passes step args to agent spawn", async () => {
    const seenArgs: unknown[] = [];
    const adapter = {
      spawn(_prompt: string, opts?: { args?: unknown }) {
        seenArgs.push(opts?.args);
        return {
          events: (async function* () {
            yield {
              type: "done" as const,
              result: "ok",
              costUsd: 0,
              durationMs: 0,
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          })(),
          abort() {},
          exited: Promise.resolve(),
        };
      },
    };

    const runner = createRunner(
      [
        { type: "task", task: "Safe", args: { "permission-mode": "auto" } },
        { type: "task", task: "Bypass", args: { "permission-mode": "bypassPermissions" } },
      ],
      { agent: adapter, projectRoot: `/tmp/loop-test-args-${Date.now()}` },
    );

    const result = await runner.run();

    expect(result.success).toBe(true);
    expect(seenArgs).toEqual([
      { "permission-mode": "auto" },
      { "permission-mode": "bypassPermissions" },
    ]);
  });

  test("cost and duration accumulation across steps", async () => {
    const steps: Step[] = [
      { type: "task", task: "Step 1" },
      { type: "task", task: "Step 2" },
      { type: "task", task: "Step 3" },
    ];
    const scenarios: Scenario[] = [
      { turns: [{ text: "Done 1" }], cost: 0.01, duration: 1000 },
      { turns: [{ text: "Done 2" }], cost: 0.02, duration: 2000 },
      { turns: [{ text: "Done 3" }], cost: 0.03, duration: 3000 },
    ];
    const runner = createTestRunner(scenarios, steps);
    const result = await runToCompletion(runner);

    expect(result.totalCostUsd).toBeCloseTo(0.06);
    expect(result.totalDurationMs).toBe(6000);
  });

  test("previousSummary passing between steps", async () => {
    const steps: Step[] = [
      { type: "task", task: "First task" },
      { type: "task", task: "Second task" },
    ];

    const prompts: string[] = [];
    const { createStubAdapter } = await import("../agents/stub.js");
    const { createRunner } = await import("./runner.js");

    const scenarios: Scenario[] = [
      { turns: [{ text: "Result from step one" }], cost: 0, duration: 0 },
      { turns: [{ text: "Done" }], cost: 0, duration: 0 },
    ];
    const scenarioList = [...scenarios];
    let spawnIndex = 0;

    const adapter = {
      spawn(prompt: string) {
        prompts.push(prompt);
        const scenario = scenarioList[spawnIndex++];
        return createStubAdapter(scenario).spawn(prompt);
      },
    };

    const runner = createRunner(steps, {
      agent: adapter,
      projectRoot: `/tmp/loop-test-summary-${Date.now()}`,
    });
    await runner.run();

    // First prompt should not contain previous summary
    expect(prompts[0]).not.toContain("Previous Step");
    // Second prompt should contain the summary from step 1
    expect(prompts[1]).toContain("Result from step one");
  });

  test("resume skips completed steps and restores their summary and totals", async () => {
    const steps: Step[] = [
      { type: "task", task: "First task" },
      { type: "task", task: "Second task" },
    ];
    const prompts: string[] = [];
    const started: number[] = [];
    const adapter = {
      spawn(prompt: string) {
        prompts.push(prompt);
        return createStubAdapter({
          turns: [{ text: "Second done" }],
          cost: 0.005,
          duration: 500,
          usage: { inputTokens: 100, outputTokens: 20 },
        }).spawn(prompt);
      },
    };
    const priorResult = {
      step: steps[0],
      iterations: 1,
      result: "First persisted summary",
      costUsd: 0.01,
      durationMs: 1000,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
      exitReason: "done" as const,
    };

    const runner = createRunner(steps, {
      agent: adapter,
      projectRoot: `/tmp/loop-test-resume-${Date.now()}`,
      resume: {
        startStepIndex: 1,
        previousSummary: "First persisted summary",
        priorStepResults: [priorResult],
        priorTotals: {
          totalCostUsd: 0.01,
          totalDurationMs: 1000,
          totalUsage: priorResult.usage,
        },
      },
      onStepExecutionStart: (index) => started.push(index),
    });
    const result = await runner.run();

    expect(started).toEqual([1]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("First persisted summary");
    expect(result.stepResults).toHaveLength(2);
    expect(result.totalCostUsd).toBe(0.015);
    expect(result.totalDurationMs).toBe(1500);
    expect(result.totalUsage.inputTokens).toBe(110);
  });

  test("previousIterationSummary passing within a loop", async () => {
    const steps: Step[] = [{ type: "task", task: "Fix bugs", until: "All fixed" }];

    const prompts: string[] = [];
    const { createStubAdapter } = await import("../agents/stub.js");
    const { createRunner } = await import("./runner.js");

    const scenarios: Scenario[] = [
      {
        turns: [{ text: "Fixed one bug\n\nLOOP_CONTINUE: Fixed auth bug, 2 remaining" }],
        cost: 0,
        duration: 0,
      },
      {
        turns: [{ text: "All done\n\nLOOP_DONE" }],
        cost: 0,
        duration: 0,
      },
    ];
    const scenarioList = [...scenarios];
    let spawnIndex = 0;

    const adapter = {
      spawn(prompt: string) {
        prompts.push(prompt);
        const scenario = scenarioList[spawnIndex++];
        return createStubAdapter(scenario).spawn(prompt);
      },
    };

    const runner = createRunner(steps, {
      agent: adapter,
      projectRoot: `/tmp/loop-test-iter-${Date.now()}`,
    });
    await runner.run();

    // First prompt should not contain previous iteration summary
    expect(prompts[0]).not.toContain("Previous Iteration");
    // Second prompt should contain the LOOP_CONTINUE status
    expect(prompts[1]).toContain("Fixed auth bug, 2 remaining");
  });

  test("abort stops execution", async () => {
    const steps: Step[] = [
      { type: "task", task: "Step 1" },
      { type: "task", task: "Step 2" },
      { type: "task", task: "Step 3" },
    ];
    const scenarios: Scenario[] = [
      { turns: [{ text: "Done 1" }], cost: 0.01, duration: 100 },
      { turns: [{ text: "Done 2" }], cost: 0.01, duration: 100 },
      { turns: [{ text: "Done 3" }], cost: 0.01, duration: 100 },
    ];
    const _runner = createTestRunner(scenarios, steps);

    // Abort after first step completes by using onStepComplete
    const { createStubAdapter } = await import("../agents/stub.js");
    const { createRunner } = await import("./runner.js");

    const adapter = createStubAdapter(scenarios);
    const runner2 = createRunner(steps, {
      agent: adapter,
      projectRoot: `/tmp/loop-test-abort-${Date.now()}`,
      onStepComplete(stepIndex) {
        if (stepIndex === 0) {
          runner2.abort();
        }
      },
    });

    const result = await runner2.run();

    // First step should succeed, rest should be skipped
    expect(result.stepResults[0].exitReason).toBe("done");
    expect(result.stepResults.length).toBe(3);
    // At least one remaining step should be skipped
    const skipped = result.stepResults.filter(
      (r) => r.error?.includes("abort") || r.error?.includes("Abort") || r.error?.includes("Skip"),
    );
    expect(skipped.length).toBeGreaterThan(0);
  });

  test("can await active agent shutdown after a callback failure", async () => {
    let abortCalls = 0;
    let exited = false;
    let resolveExit: (() => void) | undefined;
    const exitedPromise = new Promise<void>((resolve) => {
      resolveExit = () => {
        exited = true;
        resolve();
      };
    });
    const adapter = {
      spawn() {
        return {
          events: (async function* () {
            yield {
              type: "session_start" as const,
              model: "stub",
              sessionId: "stub-session",
              tools: [],
            };
          })(),
          exited: exitedPromise,
          abort() {
            abortCalls++;
            setTimeout(() => resolveExit?.(), 20);
          },
        };
      },
    };
    const runner = createRunner([{ type: "task", task: "work" }], {
      agent: adapter,
      onEvent() {
        throw new Error("event persistence failed");
      },
    });

    let runError: unknown;
    try {
      await runner.run();
    } catch (error) {
      runError = error;
    }
    expect(runError).toBeInstanceOf(Error);
    expect((runError as Error).message).toBe("event persistence failed");

    const awaitableRunner = runner as unknown as { abortAndWait?: () => Promise<void> };
    expect(typeof awaitableRunner.abortAndWait).toBe("function");
    await awaitableRunner.abortAndWait?.();
    expect(abortCalls).toBe(1);
    expect(exited).toBe(true);
  });

  test("ralph loop without markers treats as LOOP_CONTINUE", async () => {
    const steps: Step[] = [{ type: "task", task: "Work on it", until: "Done", max: 3 }];
    const scenarios: Scenario[] = [
      { turns: [{ text: "Did some work" }], cost: 0.01, duration: 100 },
      { turns: [{ text: "Did more work" }], cost: 0.01, duration: 100 },
      { turns: [{ text: "Even more work" }], cost: 0.01, duration: 100 },
    ];
    const runner = createTestRunner(scenarios, steps);
    const result = await runToCompletion(runner);

    expect(result.stepResults[0].iterations).toBe(3);
    expect(result.stepResults[0].exitReason).toBe("max_reached");
  });

  test("onEvent callback receives events", async () => {
    const steps: Step[] = [{ type: "task", task: "Do it" }];
    const { createStubAdapter } = await import("../agents/stub.js");
    const { createRunner } = await import("./runner.js");

    const events: Array<{ event: AgentEvent; stepIndex: number }> = [];
    const adapter = createStubAdapter(SIMPLE_TEXT);

    type AgentEvent = import("../agents/types.js").AgentEvent;

    const runner = createRunner(steps, {
      agent: adapter,
      projectRoot: `/tmp/loop-test-events-${Date.now()}`,
      onEvent(event, stepIndex) {
        events.push({ event, stepIndex });
      },
    });
    await runner.run();

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].event.type).toBe("session_start");
    expect(events[0].stepIndex).toBe(0);

    const doneEvents = events.filter((e) => e.event.type === "done");
    expect(doneEvents).toHaveLength(1);
  });

  test("getState returns current pipeline state", async () => {
    const steps: Step[] = [{ type: "task", task: "Do it" }];
    const runner = createTestRunner(SIMPLE_TEXT, steps);

    const stateBefore = runner.getState();
    expect(stateBefore.totalSteps).toBe(1);
    expect(stateBefore.costUsd).toBe(0);
    expect(stateBefore.currentSessionCostUsd).toBe(0);

    await runToCompletion(runner);

    const stateAfter = runner.getState();
    expect(stateAfter.costUsd).toBe(0.003);
    expect(stateAfter.currentSessionCostUsd).toBe(0.003);
  });

  test("usage_update updates pipeline state before onEvent", async () => {
    const steps: Step[] = [{ type: "task", task: "Do it" }];
    const usage = {
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationTokens: 5,
      cacheReadTokens: 10,
    };
    const adapter = createStubAdapter({
      turns: [{ text: "Done" }],
      cost: 0.05,
      usage,
      usageUpdates: [{ type: "usage_update", costUsd: 0.05, usage }],
    });
    const seenStates: Array<{
      costUsd: number;
      currentSessionCostUsd: number;
      usage: TokenUsage;
      currentSessionUsage: TokenUsage;
    }> = [];
    const runner = createRunner(steps, {
      agent: adapter,
      projectRoot: `/tmp/loop-test-usage-${Date.now()}`,
      onEvent(event) {
        if (event.type === "usage_update") {
          const state = runner.getState();
          seenStates.push({
            costUsd: state.costUsd,
            currentSessionCostUsd: state.currentSessionCostUsd,
            usage: state.usage,
            currentSessionUsage: state.currentSessionUsage,
          });
        }
      },
    });

    await runner.run();

    expect(seenStates).toEqual([
      { costUsd: 0.05, currentSessionCostUsd: 0.05, usage, currentSessionUsage: usage },
    ]);
    expect(runner.getState().costUsd).toBe(0.05);
    expect(runner.getState().currentSessionCostUsd).toBe(0.05);
    expect(runner.getState().usage).toEqual(usage);
    expect(runner.getState().currentSessionUsage).toEqual(usage);
  });
});
