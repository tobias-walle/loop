import type { Scenario } from "../agents/stub.js";
import { createStubAdapter } from "../agents/stub.js";
import type { AgentEvent, AgentSession } from "../agents/types.js";
import type { Runner } from "../lib/runner.js";
import { createRunner } from "../lib/runner.js";
import type { RunResult, Step } from "../lib/types.js";

/**
 * Create a runner wired to the stub adapter.
 * Uses a temp directory as projectRoot to avoid polluting the real project.
 */
export function createTestRunner(scenarios: Scenario | Scenario[], steps: Step[]): Runner {
  const adapter = createStubAdapter(scenarios);
  return createRunner(steps, {
    agent: adapter,
    projectRoot: `/tmp/loop-test-${Date.now()}`,
  });
}

/** Collect all events from a session into an array. */
export async function collectEvents(session: AgentSession): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.events) {
    events.push(event);
  }
  return events;
}

/** Run the runner to completion and return the result. */
export async function runToCompletion(runner: Runner): Promise<RunResult> {
  return runner.run();
}
