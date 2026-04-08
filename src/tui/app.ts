import {
  type Component,
  Container,
  ProcessTerminal,
  Spacer,
  TUI,
  Text,
  matchesKey,
} from "@mariozechner/pi-tui";
import type { AgentEvent } from "../agents/types.js";
import type { RunSummary, TokenUsage } from "../lib/types.js";
import { dim } from "./colors.js";
import {
  formatCompletion,
  formatError,
  formatRetry,
  formatRunSummary,
  formatStepHeader,
  formatTokenCount,
  formatToolLine,
  formatUserMessage,
} from "./event-log.js";
import { PipeBox } from "./pipe-box.js";
import { StatusBar } from "./status-bar.js";
import { ThinkingIndicator } from "./thinking-indicator.js";

export interface LoopTUIOptions {
  onUserMessage?: (message: string) => void;
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
  ): void;
  showCompletion(
    type: "done" | "loop_done" | "max_reached",
    durationMs: number,
    iterations?: number,
    costUsd?: number,
    usage?: TokenUsage,
  ): void;
  showRunSummary(summary: RunSummary): void;
  showUserMessage(text: string): void;
  updateStatus(info: {
    step?: number;
    totalSteps?: number;
    iteration?: number;
    max?: number;
    costUsd?: number;
    durationMs?: number;
  }): void;
}

/** Any component that can hold children (Container, PipeBox, etc.) */
type ChildContainer = Component & {
  children: Component[];
  addChild(c: Component): void;
  removeChild(c: Component): void;
};

/**
 * Internal state used for event routing.
 * Exported for testing.
 */
export interface LoopTUIState {
  containerStack: ChildContainer[];
  toolIdToContainer: Map<string, ChildContainer>;
  textBlocks: Map<string, { textRef: Text; accumulated: string }>;
  thinkingIndicator: { node: ThinkingIndicator; parent: ChildContainer } | null;
}

/**
 * Create the event routing logic decoupled from the real TUI.
 * Accepts an arbitrary root container and a render callback.
 */
export function createEventRouter(
  root: Container,
  requestRender: () => void,
): {
  state: LoopTUIState;
  handleEvent: (event: AgentEvent, stepIndex: number) => void;
  showStepHeader: (
    step: number,
    totalSteps: number,
    task: string,
    iteration?: number,
    max?: number,
  ) => void;
  showCompletion: (
    type: "done" | "loop_done" | "max_reached",
    durationMs: number,
    iterations?: number,
    costUsd?: number,
    usage?: TokenUsage,
  ) => void;
  showRunSummary: (summary: RunSummary) => void;
  showUserMessage: (text: string) => void;
} {
  const state: LoopTUIState = {
    containerStack: [root],
    toolIdToContainer: new Map(),
    textBlocks: new Map(),
    thinkingIndicator: null,
  };

  function currentContainer(): ChildContainer {
    return state.containerStack[state.containerStack.length - 1];
  }

  function removeThinkingIndicator(): void {
    if (state.thinkingIndicator) {
      state.thinkingIndicator.node.stop();
      state.thinkingIndicator.parent.removeChild(state.thinkingIndicator.node);
      state.thinkingIndicator = null;
    }
  }

  function containerForEvent(parentToolUseId: string | null): ChildContainer {
    if (parentToolUseId !== null) {
      const mapped = state.toolIdToContainer.get(parentToolUseId);
      if (mapped) return mapped;
    }
    return currentContainer();
  }

  function handleEvent(event: AgentEvent, _stepIndex: number): void {
    if (state.thinkingIndicator) {
      if (event.type === "session_start") {
        // Agent process is connected — switch from "Waiting..." to "Thinking..."
        state.thinkingIndicator.node.setText("Thinking...");
        requestRender();
      } else if (
        event.type === "text_delta" ||
        event.type === "tool_start" ||
        event.type === "task_started" ||
        event.type === "error"
      ) {
        // Agent produced visible output — remove the indicator
        removeThinkingIndicator();
        requestRender();
      }
    }

    switch (event.type) {
      case "text_delta": {
        const key = event.parentToolUseId ?? "__root__";
        const container = containerForEvent(event.parentToolUseId);
        const existing = state.textBlocks.get(key);
        if (existing) {
          existing.accumulated += event.text;
          existing.textRef.setText(`💬 ${existing.accumulated}`);
        } else {
          const accumulated = event.text;
          const textRef = new Text(`💬 ${accumulated}`, 0, 0);
          container.addChild(textRef);
          state.textBlocks.set(key, { textRef, accumulated });
        }
        requestRender();
        break;
      }

      case "text_done": {
        const key = event.parentToolUseId ?? "__root__";
        state.textBlocks.delete(key);
        break;
      }

      case "tool_start": {
        // Agent/Task tools: render the start line and create the nested container here,
        // since the tool input carries model info that task_started lacks.
        if (event.tool === "Task" || event.tool === "Agent") {
          const container = containerForEvent(event.parentToolUseId);
          const description = String(event.input?.description ?? "");
          const model = event.input?.model;
          const modelSuffix = typeof model === "string" && model ? ` (${model})` : "";
          container.addChild(new Text(dim(`┌ ${event.tool}: ${description}${modelSuffix}`), 0, 0));
          const subBox = new PipeBox();
          container.addChild(subBox);
          state.containerStack.push(subBox);
          state.toolIdToContainer.set(event.toolId, subBox);
          requestRender();
          break;
        }

        const container = containerForEvent(event.parentToolUseId);
        const line = formatToolLine(event.tool, event.input);
        container.addChild(new Text(line, 0, 0));
        requestRender();
        break;
      }

      case "tool_done": {
        // Cleanup container mapping (task_done handles visual closure for Agent/Task tools)
        state.toolIdToContainer.delete(event.toolId);
        break;
      }

      case "retry": {
        const container = currentContainer();
        container.addChild(
          new Text(formatRetry(event.attempt, event.maxRetries, event.error), 0, 0),
        );
        requestRender();
        break;
      }

      case "error": {
        const container = currentContainer();
        container.addChild(new Text(formatError(event.message), 0, 0));
        requestRender();
        break;
      }

      case "task_started": {
        // Visual setup already handled by tool_start for Agent/Task.
        // Only wire up the toolUseId → container mapping if not already present
        // (covers edge cases where task_started arrives without a preceding tool_start).
        if (!state.toolIdToContainer.has(event.toolUseId)) {
          const container = currentContainer();
          container.addChild(new Text(dim(`┌ Agent: ${event.description}`), 0, 0));
          const subBox = new PipeBox();
          container.addChild(subBox);
          state.containerStack.push(subBox);
          state.toolIdToContainer.set(event.toolUseId, subBox);
          requestRender();
        }
        break;
      }

      case "task_done": {
        const mapped = state.toolIdToContainer.get(event.toolUseId);
        const parent = (() => {
          if (!mapped) return currentContainer();
          const idx = state.containerStack.indexOf(mapped);
          return idx > 0 ? state.containerStack[idx - 1] : currentContainer();
        })();
        if (mapped) {
          const idx = state.containerStack.indexOf(mapped);
          if (idx !== -1) {
            state.containerStack.splice(idx, 1);
          }
          state.toolIdToContainer.delete(event.toolUseId);
        }
        const durationSec = (event.durationMs / 1000).toFixed(1);
        const meta: string[] = [`${durationSec}s`];
        if (event.totalTokens != null) meta.push(`${formatTokenCount(event.totalTokens)} tokens`);
        parent.addChild(
          new Text(dim(`└ ${event.status}: ${event.summary} (${meta.join(" · ")})`), 0, 0),
        );
        requestRender();
        break;
      }

      default:
        break;
    }
  }

  function showStepHeader(
    step: number,
    totalSteps: number,
    task: string,
    iteration?: number,
    max?: number,
  ): void {
    const header = formatStepHeader(step, totalSteps, task, iteration, max);
    // Reset container stack so nested containers from previous steps don't leak
    state.containerStack.length = 1;
    state.toolIdToContainer.clear();
    state.textBlocks.clear();
    removeThinkingIndicator();
    // Visual gap before headers
    root.addChild(new Spacer());
    root.addChild(new Text(header, 0, 0));
    const thinking = new ThinkingIndicator(requestRender);
    root.addChild(thinking);
    thinking.start();
    state.thinkingIndicator = { node: thinking, parent: root };
    requestRender();
  }

  function showCompletion(
    type: "done" | "loop_done" | "max_reached",
    durationMs: number,
    iterations?: number,
    costUsd?: number,
    usage?: TokenUsage,
  ): void {
    root.addChild(new Spacer());
    const text = formatCompletion(type, durationMs, iterations, costUsd, usage);
    root.addChild(new Text(text, 0, 0));
    requestRender();
  }

  function showRunSummary(summary: RunSummary): void {
    root.addChild(new Spacer());
    root.addChild(new Text(formatRunSummary(summary), 0, 0));
    requestRender();
  }

  function showUserMessage(text: string): void {
    const line = formatUserMessage(text);
    root.addChild(new Text(line, 0, 0));
    requestRender();
  }

  return { state, handleEvent, showStepHeader, showCompletion, showRunSummary, showUserMessage };
}

export function createLoopTUI(opts?: LoopTUIOptions): LoopTUI {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  let statusInterval: ReturnType<typeof setInterval> | null = null;
  let startTime = Date.now();

  // Content container holds all event output.
  // StatusBar sits below it as a sibling - no overlay, so no screen-filling padding.
  const content = new Container();
  const statusBar = new StatusBar();

  tui.addChild(content);
  tui.addChild(statusBar);

  statusBar.onSubmit = (message: string) => {
    opts?.onUserMessage?.(message);
  };

  const router = createEventRouter(content, () => tui.requestRender());

  return {
    start(): void {
      startTime = Date.now();
      statusBar.setStartTime(startTime);

      tui.start();

      // Catch Ctrl+C at the TUI level before any component routing.
      // matchesKey handles all encodings (raw \x03, Kitty protocol, modifyOtherKeys).
      tui.addInputListener((data) => {
        if (matchesKey(data, "ctrl+c")) {
          opts?.onInterrupt?.();
          return { consume: true };
        }
        return undefined;
      });
      tui.setFocus(statusBar);

      // Update footer every second for the live timer
      statusInterval = setInterval(() => {
        tui.requestRender();
      }, 1000);
    },

    stop(): void {
      if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
      }
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
    ): void {
      router.showStepHeader(step, totalSteps, task, iteration, max);
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

    showRunSummary(summary: RunSummary): void {
      router.showRunSummary(summary);
    },

    showUserMessage(text: string): void {
      router.showUserMessage(text);
    },

    updateStatus(info: {
      step?: number;
      totalSteps?: number;
      iteration?: number;
      max?: number;
      costUsd?: number;
      durationMs?: number;
    }): void {
      statusBar.setStatus({ ...info, durationMs: Date.now() - startTime });
      tui.requestRender();
    },
  };
}
