#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { createClaudeAdapter } from "./agents/claude.js";
import { ParseError, parseArgs } from "./lib/parser.js";
import { createRunner } from "./lib/runner.js";
import { DEFAULT_TEMPLATE } from "./lib/template.js";
import type { LoopConfig } from "./lib/types.js";
import { createLoopTUI } from "./tui/app.js";

// Public API re-exports
export type {
  AgentAdapter,
  AgentEvent,
  AgentSession,
  AgentSpawnOptions,
  TokenUsage,
} from "./agents/types.js";
export type { Scenario, ToolCall, Turn } from "./agents/stub.js";
export { createStubAdapter } from "./agents/stub.js";
export { createClaudeAdapter } from "./agents/claude.js";
export { ParseError, parseArgs } from "./lib/parser.js";
export { createRunner } from "./lib/runner.js";
export type { RunnerOptions } from "./lib/runner.js";
export { DEFAULT_TEMPLATE, loadTemplate, renderTemplate } from "./lib/template.js";
export type {
  LoopConfig,
  PipelineState,
  RunResult,
  Step,
  StepResult,
  TemplateContext,
} from "./lib/types.js";
export { createLoopTUI } from "./tui/app.js";
export type { LoopTUI, LoopTUIOptions } from "./tui/app.js";

function runInit(): void {
  const dest = path.join(process.cwd(), "LOOP.md");

  if (fs.existsSync(dest)) {
    console.log("LOOP.md already exists in this directory. Skipping.");
    return;
  }

  fs.writeFileSync(dest, DEFAULT_TEMPLATE, "utf-8");
  console.log("Created LOOP.md in the current directory.");
}

async function main(): Promise<void> {
  let config: LoopConfig;
  try {
    config = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof ParseError) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  if (config.command === "init") {
    runInit();
    return;
  }

  if (config.steps.length === 0) {
    console.error('Error: No tasks provided. Usage: loop "task"');
    process.exit(1);
  }

  const adapter = createClaudeAdapter();

  let runner: ReturnType<typeof createRunner>;

  const tui = createLoopTUI({
    onUserMessage: (message) => {
      runner.sendMessage(message);
      tui.showUserMessage(message);
    },
    onInterrupt: () => {
      tui.stop();
      runner.abort();
      process.exit(130);
    },
  });

  tui.start();

  runner = createRunner(config.steps, {
    agent: adapter,
    projectRoot: process.cwd(),
    onEvent: (event, stepIndex) => {
      tui.handleEvent(event, stepIndex);
      const state = runner.getState();
      tui.updateStatus({
        step: stepIndex + 1,
        totalSteps: state.totalSteps,
        costUsd: state.costUsd,
      });
    },
    onStepStart: (stepIndex, step, iteration) => {
      const task = step.type === "task" ? step.task : step.tasks.join(", ");
      const isLoop = step.until != null || (step.repeat != null && step.repeat > 1);
      tui.showStepHeader(
        stepIndex + 1,
        config.steps.length,
        task,
        isLoop ? iteration : undefined,
        step.max,
      );
      tui.updateStatus({
        step: stepIndex + 1,
        totalSteps: config.steps.length,
        iteration: isLoop ? iteration : undefined,
        max: step.max,
        costUsd: runner.getState().costUsd,
      });
    },
    onStepComplete: (stepIndex, result) => {
      if (result.exitReason !== "error") {
        tui.showCompletion(result.exitReason, result.durationMs, result.iterations);
      }
      tui.updateStatus({
        step: stepIndex + 1,
        totalSteps: config.steps.length,
        costUsd: runner.getState().costUsd,
      });
    },
  });

  try {
    const result = await runner.run();
    if (!result.success) {
      const failedStep = result.stepResults.find((s) => s.exitReason === "error");
      if (failedStep?.error) {
        tui.handleEvent({ type: "error", message: failedStep.error }, 0);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    tui.handleEvent({ type: "error", message }, 0);
  }

  // Brief pause so user can see the final state
  await new Promise((resolve) => setTimeout(resolve, 500));
  tui.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
