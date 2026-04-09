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

  const sessionDir = createSessionDir(process.cwd());
  const logger = createLogger(sessionDir);
  const adapter = createClaudeAdapter({ interactive: true, logger });

  logger.info("Session initialized", { source: "loop", type: "session_init", sessionDir });
  logger.info("Config parsed", {
    source: "loop",
    type: "config_parsed",
    stepCount: config.steps.length,
    commandType: config.command,
  });
  logger.debug("Claude adapter created", {
    source: "loop",
    type: "adapter_created",
    interactive: true,
  });

  let runner: ReturnType<typeof createRunner>;

  const tui = createLoopTUI({
    onUserMessage: (message) => {
      logger.info("User message received", { source: "loop", type: "user_message", message });
      runner.sendMessage(message);
      tui.showUserMessage(message);
    },
    onInterrupt: () => {
      logger.warn("User interrupt received", { source: "loop", type: "interrupt" });
      tui.stop();
      runner.abort();
      process.exit(130);
    },
  });

  tui.start();
  tui.showSessionInfo(path.basename(sessionDir));
  logger.debug("TUI initialized", { source: "loop", type: "tui_started" });

  // Ensure the terminal is always restored, even on unexpected exits.
  process.on("exit", () => tui.stop());

  runner = createRunner(config.steps, {
    agent: adapter,
    projectRoot: process.cwd(),
    logger,
    onEvent: (event, stepIndex) => {
      tui.handleEvent(event, stepIndex);
      logger.debug("Agent event", { source: "agent", stepIndex, eventType: event.type });
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
      const maxDisplay =
        step.max ?? (step.repeat != null && step.repeat > 1 ? step.repeat : undefined);
      tui.showStepHeader(
        stepIndex + 1,
        config.steps.length,
        task,
        isLoop ? iteration : undefined,
        maxDisplay,
      );
      tui.updateStatus({
        step: stepIndex + 1,
        totalSteps: config.steps.length,
        iteration: isLoop ? iteration : undefined,
        max: maxDisplay,
        costUsd: runner.getState().costUsd,
      });
    },
    onStepComplete: (stepIndex, result) => {
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
      logger.warn("Run finished with failure", {
        source: "loop",
        type: "run_failure",
        failedStepError: failedStep?.error,
        failedStepExitReason: failedStep?.exitReason,
      });
      if (failedStep?.error) {
        tui.handleEvent({ type: "error", message: failedStep.error }, 0);
      }
    }
    tui.showRunSummary({
      totalCostUsd: result.totalCostUsd,
      totalDurationMs: result.totalDurationMs,
      totalUsage: result.totalUsage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Run error", { source: "loop", type: "run_error", error: message });
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
