import { Container, ProcessTerminal, TUI } from "@mariozechner/pi-tui";
import type { AgentEvent } from "../agents/types.js";
import type { AgentArgs } from "../lib/agent-args.js";
import type { RunSummary, TokenUsage } from "../lib/types.js";
import { StatusBar } from "./components/status-bar.js";
import { createEventRouter } from "./event-router.js";

export interface LoopTUIOptions {
  onInterrupt?: () => void;
}

export interface LoopTUI {
  start(): void;
  stop(): void;
  handleEvent(event: AgentEvent, stepIndex: number): void;
  showStepHeader(
    step: number,
    totalSteps: number,
    task: string,
    iteration?: number,
    max?: number,
    model?: string,
    agent?: string,
    agentArgs?: AgentArgs,
  ): void;
  showCompletion(
    type: "done" | "loop_done" | "max_reached",
    durationMs: number,
    iterations?: number,
    costUsd?: number,
    usage?: TokenUsage,
  ): void;
  showSessionInfo(sessionId: string): void;
  showRunSummary(summary: RunSummary): void;
  updateStatus(info: {
    step?: number;
    totalSteps?: number;
    iteration?: number;
    max?: number;
    costUsd?: number;
    currentSessionCostUsd?: number;
    durationMs?: number;
    usage?: TokenUsage;
    currentSessionUsage?: TokenUsage;
  }): void;
}

export function createLoopTUI(opts?: LoopTUIOptions): LoopTUI {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  let statusInterval: ReturnType<typeof setInterval> | null = null;
  let startTime = Date.now();

  const content = new Container();
  const statusBar = new StatusBar();

  tui.addChild(content);
  tui.addChild(statusBar);

  statusBar.onInterrupt = () => {
    opts?.onInterrupt?.();
  };

  const router = createEventRouter(content, () => tui.requestRender());

  return {
    start(): void {
      startTime = Date.now();
      statusBar.setStartTime(startTime);

      tui.start();
      tui.setFocus(statusBar);

      statusInterval = setInterval(() => {
        tui.requestRender();
      }, 1000);
    },

    stop(): void {
      if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
      }
      statusBar.hide();
      (tui as unknown as { doRender(): void }).doRender();
      tui.stop();
    },

    handleEvent(event: AgentEvent, stepIndex: number): void {
      router.handleEvent(event, stepIndex);
    },

    showStepHeader(
      step: number,
      totalSteps: number,
      task: string,
      iteration?: number,
      max?: number,
      model?: string,
      agent?: string,
      agentArgs?: AgentArgs,
    ): void {
      router.showStepHeader(step, totalSteps, task, iteration, max, model, agent, agentArgs);
    },

    showCompletion(
      type: "done" | "loop_done" | "max_reached",
      durationMs: number,
      iterations?: number,
      costUsd?: number,
      usage?: TokenUsage,
    ): void {
      router.showCompletion(type, durationMs, iterations, costUsd, usage);
    },

    showSessionInfo(sessionId: string): void {
      router.showSessionInfo(sessionId);
    },

    showRunSummary(summary: RunSummary): void {
      router.showRunSummary(summary);
    },

    updateStatus(info: {
      step?: number;
      totalSteps?: number;
      iteration?: number;
      max?: number;
      costUsd?: number;
      currentSessionCostUsd?: number;
      durationMs?: number;
      usage?: TokenUsage;
      currentSessionUsage?: TokenUsage;
    }): void {
      statusBar.setStatus({ ...info, durationMs: Date.now() - startTime });
      tui.requestRender();
    },
  };
}
