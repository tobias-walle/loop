import { type Component, type Container, Spacer, Text } from "@mariozechner/pi-tui";
import type { AgentEvent } from "../agents/types.js";
import { dim, dimGray } from "../lib/ansi.js";
import type { RunSummary, TokenUsage } from "../lib/types.js";
import { ThinkingIndicator } from "./components/thinking-indicator.js";
import type { ChildContainer, LoopTUIState } from "./event-handlers.js";
import {
  ROOT_KEY,
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
  formatStepHeaderLines,
} from "./formatters.js";

export type { ChildContainer, LoopTUIState } from "./event-handlers.js";

class Separator implements Component {
  invalidate(): void {
    // No caching
  }

  render(width: number): string[] {
    return [dimGray("─".repeat(width))];
  }
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
} {
  const state: LoopTUIState = {
    containerStack: [root],
    toolIdToContainer: new Map(),
    toolIdToParentContainer: new Map(),
    textBlocks: new Map(),
    thinkingIndicators: new Map(),
  };

  let sessionDone = false;

  function currentContainer(): ChildContainer {
    return state.containerStack[state.containerStack.length - 1];
  }

  function addThinkingIndicator(
    key: string,
    container: ChildContainer,
    label: "waiting" | "thinking" = "waiting",
  ): void {
    if (sessionDone || state.thinkingIndicators.has(key)) return;
    const thinking = new ThinkingIndicator(requestRender);
    thinking.setText(label);
    container.addChild(thinking);
    thinking.start();
    state.thinkingIndicators.set(key, { node: thinking, parent: container });
    requestRender();
  }

  function removeThinkingIndicator(key: string): void {
    const indicator = state.thinkingIndicators.get(key);
    if (indicator) {
      indicator.node.stop();
      indicator.parent.removeChild(indicator.node);
      state.thinkingIndicators.delete(key);
    }
  }

  function removeAllThinkingIndicators(): void {
    for (const [key] of state.thinkingIndicators) {
      removeThinkingIndicator(key);
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
    metaNode: Text;
    taskNode: Text;
  } | null = null;

  function handleEvent(event: AgentEvent, _stepIndex: number): void {
    if (event.type === "session_start" && headerInfo && headerInfo.model !== event.model) {
      headerInfo.model = event.model;
      const { step, totalSteps, task, iteration, max, model } = headerInfo;
      const [metaLine, taskLine] = formatStepHeaderLines(
        step,
        totalSteps,
        task,
        iteration,
        max,
        model,
      );
      headerInfo.metaNode.setText(metaLine);
      headerInfo.taskNode.setText(taskLine);
      requestRender();
    }

    if (event.type === "text_delta" || event.type === "tool_start") {
      const key = event.parentToolUseId ?? ROOT_KEY;
      if (state.thinkingIndicators.has(key)) {
        removeThinkingIndicator(key);
        requestRender();
      }
    }
    if (event.type === "error") {
      if (state.thinkingIndicators.has(ROOT_KEY)) {
        removeThinkingIndicator(ROOT_KEY);
        requestRender();
      }
    }

    switch (event.type) {
      case "text_delta":
        handleTextDelta(event, state, requestRender, containerForEvent);
        break;
      case "text_done": {
        state.textBlocks.delete(event.parentToolUseId ?? ROOT_KEY);
        const key = event.parentToolUseId ?? ROOT_KEY;
        const container = containerForEvent(event.parentToolUseId);
        addThinkingIndicator(key, container, "thinking");
        break;
      }
      case "tool_start":
        handleToolStart(event, state, requestRender, containerForEvent);
        if (event.tool === "Task" || event.tool === "Agent") {
          const subContainer = state.toolIdToContainer.get(event.toolId);
          if (subContainer) {
            addThinkingIndicator(event.toolId, subContainer);
          }
        }
        break;
      case "tool_done": {
        state.toolIdToContainer.delete(event.toolId);
        const key = event.parentToolUseId ?? ROOT_KEY;
        const container = containerForEvent(event.parentToolUseId);
        addThinkingIndicator(key, container);
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
        handleTaskStarted(event, state, requestRender, currentContainer);
        const subContainer = state.toolIdToContainer.get(event.toolUseId);
        if (subContainer) addThinkingIndicator(event.toolUseId, subContainer);
        break;
      }
      case "task_done":
        removeThinkingIndicator(event.toolUseId);
        handleTaskDone(event, state, requestRender, currentContainer);
        break;
      case "done":
        sessionDone = true;
        removeAllThinkingIndicators();
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
    const [metaLine, taskLine] = formatStepHeaderLines(
      step,
      totalSteps,
      task,
      iteration,
      max,
      model,
    );
    state.containerStack.length = 1;
    state.toolIdToContainer.clear();
    state.toolIdToParentContainer.clear();
    state.textBlocks.clear();
    removeAllThinkingIndicators();
    sessionDone = false;
    root.addChild(new Spacer());
    const metaNode = new Text(metaLine, 0, 0);
    const taskNode = new Text(taskLine, 0, 0);
    root.addChild(metaNode);
    root.addChild(taskNode);
    root.addChild(new Spacer());
    headerInfo = { step, totalSteps, task, iteration, max, model, metaNode, taskNode };
    const thinking = new ThinkingIndicator(requestRender);
    root.addChild(thinking);
    thinking.start();
    state.thinkingIndicators.set(ROOT_KEY, { node: thinking, parent: root });
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
    root.addChild(new Spacer());
    root.addChild(new Separator());
    requestRender();
  }

  function showSessionInfo(sessionId: string): void {
    root.addChild(new Text(dim(`session ${sessionId}`), 0, 0));
    requestRender();
  }

  function showRunSummary(summary: RunSummary): void {
    root.addChild(new Spacer());
    root.addChild(new Text(formatRunSummary(summary), 0, 0));
    requestRender();
  }

  return {
    state,
    handleEvent,
    showStepHeader,
    showCompletion,
    showSessionInfo,
    showRunSummary,
  };
}
