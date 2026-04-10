import { type Container, Spacer, Text } from "@mariozechner/pi-tui";
import type { AgentEvent } from "../agents/types.js";
import { dim } from "../lib/ansi.js";
import type { RunSummary, TokenUsage } from "../lib/types.js";
import { ThinkingIndicator } from "./components/thinking-indicator.js";
import type { ChildContainer, LoopTUIState } from "./event-handlers.js";
import {
  handleTaskDone,
  handleTaskStarted,
  handleTextDelta,
  handleToolStart,
} from "./event-handlers.js";
import {
  formatCompletion,
  formatError,
  formatRetry,
  formatRunSummary,
  formatStepHeader,
  formatUserMessage,
} from "./formatters.js";

export type { ChildContainer, LoopTUIState } from "./event-handlers.js";

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
    model?: string,
  ) => void;
  showCompletion: (
    type: "done" | "loop_done" | "max_reached",
    durationMs: number,
    iterations?: number,
    costUsd?: number,
    usage?: TokenUsage,
  ) => void;
  showSessionInfo: (sessionId: string) => void;
  showRunSummary: (summary: RunSummary) => void;
  showUserMessage: (text: string) => void;
} {
  const state: LoopTUIState = {
    containerStack: [root],
    toolIdToContainer: new Map(),
    toolIdToParentContainer: new Map(),
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

  function containerForEvent(id: string | null): ChildContainer {
    return (id !== null && state.toolIdToContainer.get(id)) || state.containerStack[0];
  }

  let headerInfo: {
    step: number;
    totalSteps: number;
    task: string;
    iteration?: number;
    max?: number;
    model?: string;
    node: Text;
  } | null = null;

  function handleEvent(event: AgentEvent, _stepIndex: number): void {
    if (event.type === "session_start" && headerInfo && !headerInfo.model) {
      headerInfo.model = event.model;
      const { step, totalSteps, task, iteration, max, model } = headerInfo;
      headerInfo.node.setText(formatStepHeader(step, totalSteps, task, iteration, max, model));
    }

    if (state.thinkingIndicator) {
      if (event.type === "session_start") {
        state.thinkingIndicator.node.setText("Thinking...");
        requestRender();
      } else if (
        event.type === "text_delta" ||
        event.type === "tool_start" ||
        event.type === "task_started" ||
        event.type === "error"
      ) {
        removeThinkingIndicator();
        requestRender();
      }
    }

    switch (event.type) {
      case "text_delta":
        handleTextDelta(event, state, requestRender, containerForEvent);
        break;
      case "text_done":
        state.textBlocks.delete(event.parentToolUseId ?? "__root__");
        break;
      case "tool_start":
        handleToolStart(event, state, requestRender, containerForEvent);
        break;
      case "tool_done":
        state.toolIdToContainer.delete(event.toolId);
        break;
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
      case "task_started":
        handleTaskStarted(event, state, requestRender, currentContainer);
        break;
      case "user_message": {
        const container = currentContainer();
        container.addChild(new Text(formatUserMessage(event.text), 0, 0));
        requestRender();
        break;
      }
      case "task_done":
        handleTaskDone(event, state, requestRender, currentContainer);
        break;
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
    model?: string,
  ): void {
    const header = formatStepHeader(step, totalSteps, task, iteration, max, model);
    state.containerStack.length = 1;
    state.toolIdToContainer.clear();
    state.toolIdToParentContainer.clear();
    state.textBlocks.clear();
    removeThinkingIndicator();
    root.addChild(new Spacer());
    const headerNode = new Text(header, 0, 0);
    root.addChild(headerNode);
    headerInfo = { step, totalSteps, task, iteration, max, model, node: headerNode };
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

  function showSessionInfo(sessionId: string): void {
    root.addChild(new Text(dim(`Session: ${sessionId}`), 0, 0));
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

  return {
    state,
    handleEvent,
    showStepHeader,
    showCompletion,
    showSessionInfo,
    showRunSummary,
    showUserMessage,
  };
}
