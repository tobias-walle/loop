/**
 * TUI test harness: runs the real TUI with a slow stub agent.
 * The agent waits for a configurable duration before completing,
 * giving the test time to interact with the input.
 *
 * Usage: bun src/testing/tui-harness.ts [durationMs]
 */
import type { AgentAdapter, AgentEvent, AgentSession } from "../agents/types.js";
import { noopLogger } from "../lib/logging.js";
import { createRunner } from "../lib/runner.js";
import type { Step } from "../lib/types.js";
import { createLoopTUI } from "../tui/loop-tui.js";

const durationMs = Number(process.argv[2]) || 10_000;

function createSlowStubAdapter(): AgentAdapter {
  return {
    spawn(_prompt: string): AgentSession {
      let aborted = false;
      let resolveWait: (() => void) | null = null;

      async function* generateEvents(): AsyncGenerator<AgentEvent> {
        yield {
          type: "session_start",
          model: "stub-model",
          sessionId: "stub-session-1",
          tools: ["Bash", "Read"],
        };

        yield { type: "text_delta", text: "Working on it...", parentToolUseId: null };
        yield { type: "text_done", text: "Working on it...", parentToolUseId: null };

        // Wait so the test can interact with the TUI
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
          setTimeout(() => {
            if (!aborted) resolve();
          }, durationMs);
        });

        yield { type: "text_delta", text: "\nDone.", parentToolUseId: null };
        yield { type: "text_done", text: "Done.", parentToolUseId: null };

        yield {
          type: "done",
          result: "Done.",
          costUsd: 0.01,
          durationMs: 1000,
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      }

      return {
        events: generateEvents(),
        sendMessage(_text: string): void {
          // no-op for stub
        },
        abort(): void {
          aborted = true;
          resolveWait?.();
        },
      };
    },
  };
}

async function main(): Promise<void> {
  const adapter = createSlowStubAdapter();
  const steps: Step[] = [{ type: "task", task: "Test task" }];

  // Use a mutable ref so TUI callbacks can access the runner before it's created
  const ref: { runner?: ReturnType<typeof createRunner> } = {};

  const tui = createLoopTUI({
    onUserMessage: (message) => {
      ref.runner?.sendMessage(message);
      tui.showUserMessage(message);
    },
    onInterrupt: () => {
      tui.stop();
      ref.runner?.abort();
      process.exit(130);
    },
  });

  tui.start();

  const runner = createRunner(steps, {
    agent: adapter,
    projectRoot: "/tmp/loop-tui-test",
    logger: noopLogger,
    onEvent: (event, stepIndex) => {
      tui.handleEvent(event, stepIndex);
      const state = runner.getState();
      tui.updateStatus({
        step: stepIndex + 1,
        totalSteps: state.totalSteps,
        costUsd: state.costUsd,
      });
    },
    onStepStart: (stepIndex, step) => {
      const task = step.type === "task" ? step.task : step.tasks.join(", ");
      tui.showStepHeader(stepIndex + 1, steps.length, task);
      tui.updateStatus({ step: stepIndex + 1, totalSteps: steps.length });
    },
    onStepComplete: (_stepIndex, result) => {
      if (result.exitReason !== "error") {
        tui.showCompletion(result.exitReason, result.durationMs, result.iterations, result.costUsd);
      }
    },
  });
  ref.runner = runner;

  await runner.run();
  await new Promise((resolve) => setTimeout(resolve, 300));
  tui.stop();
  process.exit(0);
}

main().catch((_err) => {
  process.exit(1);
});
