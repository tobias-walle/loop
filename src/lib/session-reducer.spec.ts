import { describe, expect, test } from "bun:test";
import type { StoredInvocation } from "./session-events";
import { createEvent } from "./session-events";
import { reduceSessionEvents } from "./session-reducer";

const invocation: StoredInvocation = {
  sessionId: "session-1",
  loopVersion: "0.1.0",
  projectRoot: "/project",
  steps: [{ type: "task", task: "work" }],
  template: { source: "default", content: "template", sha256: "hash" },
  agent: { name: "pi", args: {}, passthroughArgs: [] },
};

const emptyResult = {
  step: invocation.steps[0],
  iterations: 1,
  result: "",
  costUsd: 0,
  durationMs: 1,
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  },
  exitReason: "done" as const,
};

describe("reduceSessionEvents", () => {
  test("marks an invalid stored invocation corrupt without crashing", () => {
    const aggregate = reduceSessionEvents([
      createEvent("session_created", { sessionId: "broken" }),
    ]);

    expect(aggregate.status).toBe("corrupt");
    expect(aggregate.resumable).toBe(false);
  });

  test("accepts an empty summary at a durable step boundary", () => {
    const aggregate = reduceSessionEvents([
      createEvent("session_created", invocation),
      createEvent("step_started", { stepIndex: 0, step: invocation.steps[0] }),
      createEvent("step_completed", { stepIndex: 0, summary: "", result: emptyResult }),
    ]);

    expect(aggregate.warnings).toEqual([]);
    expect(aggregate.status).toBe("completed");
    expect(aggregate.nextStepIndex).toBe(1);
    expect(aggregate.resumable).toBe(false);
  });

  test("counts the latest execution usage snapshot without duplicating completed totals", () => {
    const result = {
      ...emptyResult,
      costUsd: 0.5,
      usage: { ...emptyResult.usage, inputTokens: 10 },
    };
    const aggregate = reduceSessionEvents([
      createEvent("session_created", invocation),
      createEvent("agent_usage_updated", {
        executionId: "execution-1",
        costUsd: 0.25,
        usage: { ...emptyResult.usage, inputTokens: 5 },
      }),
      createEvent("agent_usage_updated", {
        executionId: "execution-1",
        costUsd: 0.5,
        usage: { ...emptyResult.usage, inputTokens: 10 },
      }),
      createEvent("step_completed", {
        stepIndex: 0,
        summary: "done",
        result,
        executionIds: ["execution-1"],
      }),
    ]);

    expect(aggregate.totals.totalCostUsd).toBe(0.5);
    expect(aggregate.totals.totalUsage.inputTokens).toBe(10);
  });

  test("retains the latest persisted usage update from an interrupted execution", () => {
    const aggregate = reduceSessionEvents([
      createEvent("session_created", invocation),
      createEvent("agent_event", {
        stepIndex: 0,
        executionId: "execution-1",
        event: {
          type: "usage_update",
          costUsd: 0.25,
          usage: { ...emptyResult.usage, inputTokens: 5 },
        },
      }),
      createEvent("attempt_aborted", {}),
    ]);

    expect(aggregate.totals.totalCostUsd).toBe(0.25);
    expect(aggregate.totals.totalUsage.inputTokens).toBe(5);
  });

  test("ignores usage reported after its lock owner is invalidated", () => {
    const aggregate = reduceSessionEvents([
      createEvent("session_created", invocation),
      createEvent("lock_invalidated", { ownerId: "owner-1" }),
      createEvent(
        "agent_event",
        {
          stepIndex: 0,
          executionId: "execution-1",
          event: {
            type: "usage_update",
            costUsd: 0.25,
            usage: { ...emptyResult.usage, inputTokens: 5 },
          },
        },
        { ownerId: "owner-1" },
      ),
    ]);

    expect(aggregate.totals.totalCostUsd).toBe(0);
    expect(aggregate.totals.totalUsage.inputTokens).toBe(0);
  });

  test("rejects a malformed durable step result", () => {
    const aggregate = reduceSessionEvents([
      createEvent("session_created", invocation),
      createEvent("step_completed", { stepIndex: 0, summary: "done", result: {} }),
    ]);

    expect(aggregate.completedSteps.size).toBe(0);
    expect(aggregate.nextStepIndex).toBe(0);
    expect(aggregate.status).toBe("corrupt");
    expect(aggregate.resumable).toBe(false);
  });

  test("reports a newly started attempt as running", () => {
    const aggregate = reduceSessionEvents([
      createEvent("session_created", invocation),
      createEvent("attempt_started", {}, { attemptId: "attempt-1" }),
      createEvent("attempt_aborted", {}, { attemptId: "attempt-1" }),
      createEvent("attempt_started", {}, { attemptId: "attempt-2" }),
    ]);

    expect(aggregate.status).toBe("running");
    expect(aggregate.attempts.at(-1)?.status).toBe("running");
  });

  test("restarts a started but unfinished step", () => {
    const aggregate = reduceSessionEvents([
      createEvent("session_created", invocation),
      createEvent("attempt_started", {}, { attemptId: "attempt-1", ownerId: "owner-1" }),
      createEvent(
        "step_started",
        { stepIndex: 0, step: invocation.steps[0] },
        { attemptId: "attempt-1", ownerId: "owner-1" },
      ),
      createEvent("attempt_aborted", {}, { attemptId: "attempt-1", ownerId: "owner-1" }),
    ]);

    expect(aggregate.status).toBe("aborted");
    expect(aggregate.interrupted).toBe(true);
    expect(aggregate.nextStepIndex).toBe(0);
    expect(aggregate.resumable).toBe(true);
  });
});
