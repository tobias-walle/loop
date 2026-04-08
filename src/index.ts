#!/usr/bin/env node

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createClaudeAdapter } from "./agents/claude.js";
import { ParseError, formatHelp, parseArgs } from "./lib/parser.js";
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
export { ParseError, formatHelp, parseArgs } from "./lib/parser.js";
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

function isRunningInContainer(): boolean {
  try {
    // Docker / Podman: /.dockerenv exists
    if (fs.existsSync("/.dockerenv")) return true;
    // cgroups: look for docker/container references
    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf-8");
    if (cgroup.includes("docker") || cgroup.includes("containerd") || cgroup.includes("lxc")) {
      return true;
    }
    // Kubernetes / generic container runtime
    if (process.env.KUBERNETES_SERVICE_HOST) return true;
    // Devcontainer
    if (process.env.REMOTE_CONTAINERS === "true" || process.env.CODESPACES === "true") return true;
    return false;
  } catch {
    return false;
  }
}

function createSessionDir(projectRoot: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const hash = crypto.randomBytes(4).toString("hex");
  const dir = path.join(projectRoot, ".loop", "sessions", `${date}-${hash}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createSessionLogger(sessionDir: string): (entry: Record<string, unknown>) => void {
  const logPath = path.join(sessionDir, "messages.jsonl");
  return (entry: Record<string, unknown>) => {
    const line = { timestamp: new Date().toISOString(), ...entry };
    try {
      fs.appendFileSync(logPath, `${JSON.stringify(line)}\n`);
    } catch {
      // Silently ignore write failures
    }
  };
}

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

  if (config.command === "help") {
    console.log(formatHelp());
    return;
  }

  if (config.command === "version") {
    const pkgPath = path.resolve(import.meta.dirname ?? ".", "../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    console.log(pkg.version);
    return;
  }

  if (config.command === "init") {
    runInit();
    return;
  }

  if (config.steps.length === 0) {
    console.error('Error: No tasks provided. Usage: loop "task"');
    process.exit(1);
  }

  if (!isRunningInContainer()) {
    const { boldRed, dim } = await import("./tui/colors.js");
    console.error(
      `${boldRed("\n  ⚠️  SECURITY WARNING\n")}\n  loop runs with --dangerously-skip-permissions, which gives the\n  agent unrestricted access to your system.\n\n  This tool must only be used inside a container:\n${dim("    - Docker / Podman\n")}${dim("    - Devcontainers\n")}${dim("    - GitHub Codespaces\n")}${dim("    - Kubernetes pods\n")}`,
    );
    process.exit(1);
  }

  const adapter = createClaudeAdapter();
  const sessionDir = createSessionDir(process.cwd());
  const log = createSessionLogger(sessionDir);

  let runner: ReturnType<typeof createRunner>;

  const tui = createLoopTUI({
    onUserMessage: (message) => {
      log({ source: "loop", type: "user_message", message });
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
      log({ source: "agent", stepIndex, ...event });
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
      log({
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
      log({
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
    log({
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
