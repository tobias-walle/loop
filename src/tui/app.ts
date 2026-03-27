import { Box, Container, ProcessTerminal, TUI, Text, matchesKey } from "@mariozechner/pi-tui";
import type { AgentEvent } from "../agents/types.js";
import { dim } from "./colors.js";
import {
  formatCompletion,
  formatError,
  formatRetry,
  formatStepHeader,
  formatToolLine,
  formatUserMessage,
} from "./event-log.js";
import { StatusBar } from "./status-bar.js";

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
  ): void;
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

/**
 * Internal state used for event routing.
 * Exported for testing.
 */
export interface LoopTUIState {
  containerStack: Container[];
  toolIdToContainer: Map<string, Container>;
  textBlocks: Map<string, { textRef: Text; accumulated: string }>;
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
  ) => void;
  showUserMessage: (text: string) => void;
} {
  const state: LoopTUIState = {
    containerStack: [root],
    toolIdToContainer: new Map(),
    textBlocks: new Map(),
  };

  function currentContainer(): Container {
    return state.containerStack[state.containerStack.length - 1];
  }

  function containerForEvent(parentToolUseId: string | null): Container {
    if (parentToolUseId !== null) {
      const mapped = state.toolIdToContainer.get(parentToolUseId);
      if (mapped) return mapped;
    }
    return currentContainer();
  }

  function handleEvent(event: AgentEvent, _stepIndex: number): void {
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
        const container = containerForEvent(event.parentToolUseId);
        const line = formatToolLine(event.tool, event.input);
        container.addChild(new Text(line, 0, 0));

        if (event.tool === "Task") {
          const subBox = new Box(3, 0);
          container.addChild(subBox);
          state.containerStack.push(subBox);
          state.toolIdToContainer.set(event.toolId, subBox);
        }

        requestRender();
        break;
      }

      case "tool_done": {
        const mapped = state.toolIdToContainer.get(event.toolId);
        if (mapped) {
          mapped.addChild(new Text(dim("└ Done"), 0, 0));
          const idx = state.containerStack.indexOf(mapped);
          if (idx !== -1) {
            state.containerStack.splice(idx, 1);
          }
          state.toolIdToContainer.delete(event.toolId);
          requestRender();
        }
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
    // Visual gap before headers (except first output)
    if (root.children.length > 0) {
      root.addChild(new Text("", 0, 0));
      root.addChild(new Text("", 0, 0));
    }
    root.addChild(new Text(header, 0, 0));
    requestRender();
  }

  function showCompletion(
    type: "done" | "loop_done" | "max_reached",
    durationMs: number,
    iterations?: number,
  ): void {
    const text = formatCompletion(type, durationMs, iterations);
    root.addChild(new Text(text, 0, 0));
    requestRender();
  }

  function showUserMessage(text: string): void {
    const line = formatUserMessage(text);
    root.addChild(new Text(line, 0, 0));
    requestRender();
  }

  return { state, handleEvent, showStepHeader, showCompletion, showUserMessage };
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
    ): void {
      router.showCompletion(type, durationMs, iterations);
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
