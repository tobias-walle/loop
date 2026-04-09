#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { createClaudeAdapter } from "./agents/claude.js";
import { boldRed, dim } from "./lib/ansi.js";
import { createLogger } from "./lib/logging.js";
import { ParseError, formatHelp, parseArgs } from "./lib/parser.js";
import { createRunner } from "./lib/runner.js";
import { isSandboxed } from "./lib/sandbox.js";
import { createSessionDir } from "./lib/session.js";
import { DEFAULT_TEMPLATE } from "./lib/template.js";
import type { LoopConfig } from "./lib/types.js";
import { createLoopTUI } from "./tui/loop-tui.js";

function runInit(): void {
  const dest = path.join(process.cwd(), "LOOP.md");

  if (fs.existsSync(dest)) {
    console.log("LOOP.md already exists in this directory. Skipping.");
    return;
  }

  fs.writeFileSync(dest, DEFAULT_TEMPLATE, "utf-8");
  console.log("Created LOOP.md in the current directory.");
}

function handlePreTuiCommand(config: LoopConfig): boolean {
  if (config.command === "help") {
    console.log(formatHelp());
    return true;
  }

  if (config.command === "version") {
    const pkgPath = path.resolve(import.meta.dirname ?? ".", "../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    console.log(pkg.version);
    return true;
  }

  if (config.command === "init") {
    runInit();
    return true;
  }

  if (config.steps.length === 0) {
    console.error('Error: No tasks provided. Usage: loop "task"');
    process.exit(1);
  }

  return false;
}

function checkSandbox(): void {
  if (!isSandboxed()) {
    console.error(
      `${boldRed("\n  ⚠️  SECURITY WARNING\n")}\n  loop runs with --dangerously-skip-permissions, which gives the\n  agent unrestricted access to your system.\n\n  This tool must only be used inside a container:\n${dim("    - Docker / Podman\n")}${dim("    - Devcontainers\n")}${dim("    - GitHub Codespaces\n")}${dim("    - Kubernetes pods\n")}`,
    );
    process.exit(1);
  }
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

  if (handlePreTuiCommand(config)) return;

  checkSandbox();

  const adapter = createClaudeAdapter({ interactive: true });
  const sessionDir = createSessionDir(process.cwd());
  const logger = createLogger(sessionDir);

  let runner: ReturnType<typeof createRunner>;

  const tui = createLoopTUI({
    onUserMessage: (message) => {
      logger.event({ source: "loop", type: "user_message", message });
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

  // Ensure the terminal is always restored, even on unexpected exits.
  process.on("exit", () => tui.stop());

  runner = createRunner(config.steps, {
    agent: adapter,
    projectRoot: process.cwd(),
    logger,
    onEvent: (event, stepIndex) => {
      tui.handleEvent(event, stepIndex);
      logger.event({ source: "agent", stepIndex, ...event });
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
      logger.event({
        source: "loop",
        type: "step_start",
        stepIndex,
        task,
        iteration,
        step,
      });
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
      logger.event({
        source: "loop",
        type: "step_complete",
        stepIndex,
        exitReason: result.exitReason,
        iterations: result.iterations,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        usage: result.usage,
        error: result.error,
      });
      if (result.exitReason !== "error") {
        tui.showCompletion(
          result.exitReason,
          result.durationMs,
          result.iterations,
          result.costUsd,
          result.usage,
        );
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
    logger.event({
      source: "loop",
      type: "run_complete",
      success: result.success,
      totalCostUsd: result.totalCostUsd,
      totalDurationMs: result.totalDurationMs,
      totalUsage: result.totalUsage,
    });
    tui.showRunSummary({
      totalCostUsd: result.totalCostUsd,
      totalDurationMs: result.totalDurationMs,
      totalUsage: result.totalUsage,
    });
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
