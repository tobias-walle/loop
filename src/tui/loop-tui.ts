import { ProcessTerminal, TUI } from "@mariozechner/pi-tui";
import type { AgentEvent } from "../agents/types.js";
import type { AgentArgs } from "../lib/agent-args.js";
import type { RunSummary, TokenUsage } from "../lib/types.js";
import { StatusBar } from "./components/status-bar.js";
import { handleGlobalInput } from "./global-input.js";
import { createRunView } from "./run-view.js";
import { type SessionBrowserOptions, createSessionBrowser } from "./session-browser.js";
import { replaySession } from "./session-replay.js";

export interface LoopTUIOptions {
  onInterrupt?: () => void;
  sessionBrowser?: Omit<SessionBrowserOptions, "history">;
}

export interface LoopTUI {
  start(): void;
  stop(): void;
  showRunScreen(): void;
  handleEvent(event: AgentEvent, stepIndex: number): void;
  showInterruption(): void;
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

  const runView = createRunView(() => tui.requestRender());
  const content = runView.content;
  const statusBar = new StatusBar();
  const browser = opts?.sessionBrowser
    ? createSessionBrowser({
        ...opts.sessionBrowser,
        history: {
          replay: (detail) => {
            if (detail.events && detail.invocation)
              replaySession(runView, detail.events, detail.invocation);
            else runView.reset();
          },
          render: (width) => runView.render(width),
          reset: () => runView.reset(),
        },
      })
    : undefined;
  let runScreenVisible = !browser;
  const mountRunScreen = (): void => {
    tui.addChild(content);
    tui.addChild(statusBar);
    tui.setFocus(null);
  };

  if (browser) {
    tui.addChild(browser);
    tui.setFocus(browser);
  } else mountRunScreen();

  tui.addInputListener((data) =>
    handleGlobalInput(data, () => {
      opts?.onInterrupt?.();
    }),
  );

  return {
    start(): void {
      startTime = Date.now();
      statusBar.setStartTime(startTime);

      tui.start();

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

    showRunScreen(): void {
      if (runScreenVisible) return;
      if (browser) tui.removeChild(browser);
      mountRunScreen();
      runScreenVisible = true;
      startTime = Date.now();
      statusBar.setStartTime(startTime);
      tui.requestRender();
    },

    handleEvent(event: AgentEvent, stepIndex: number): void {
      runView.router.handleEvent(event, stepIndex);
    },

    showInterruption(): void {
      runView.router.showInterruption();
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
      runView.router.showStepHeader(
        step,
        totalSteps,
        task,
        iteration,
        max,
        model,
        agent,
        agentArgs,
      );
    },

    showCompletion(
      type: "done" | "loop_done" | "max_reached",
      durationMs: number,
      iterations?: number,
      costUsd?: number,
      usage?: TokenUsage,
    ): void {
      runView.router.showCompletion(type, durationMs, iterations, costUsd, usage);
    },

    showSessionInfo(sessionId: string): void {
      if (!runView.hasContent()) runView.router.showSessionInfo(sessionId);
    },

    showRunSummary(summary: RunSummary): void {
      runView.router.showRunSummary(summary);
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
