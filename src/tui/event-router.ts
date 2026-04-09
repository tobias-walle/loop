import { type Component, type Container, Spacer, Text } from "@mariozechner/pi-tui";
import type { AgentEvent } from "../agents/types.js";
import { dim } from "../lib/ansi.js";
import type { RunSummary, TokenUsage } from "../lib/types.js";
import { PipeBox } from "./components/pipe-box.js";
import { ThinkingIndicator } from "./components/thinking-indicator.js";
import {
  formatCompletion,
  formatError,
  formatRetry,
  formatRunSummary,
  formatStepHeader,
  formatTokenCount,
  formatToolLine,
  formatUserMessage,
} from "./formatters.js";

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
  ): void {
    const header = formatStepHeader(step, totalSteps, task, iteration, max);
    state.containerStack.length = 1;
    state.toolIdToContainer.clear();
    state.textBlocks.clear();
    removeThinkingIndicator();
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

// --- Event handler helpers ---

function handleTextDelta(
  event: Extract<AgentEvent, { type: "text_delta" }>,
  state: LoopTUIState,
  requestRender: () => void,
  containerForEvent: (parentToolUseId: string | null) => ChildContainer,
): void {
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
}

function handleToolStart(
  event: Extract<AgentEvent, { type: "tool_start" }>,
  state: LoopTUIState,
  requestRender: () => void,
  containerForEvent: (parentToolUseId: string | null) => ChildContainer,
): void {
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
    return;
  }

  const container = containerForEvent(event.parentToolUseId);
  const line = formatToolLine(event.tool, event.input);
  container.addChild(new Text(line, 0, 0));
  requestRender();
}

function handleTaskStarted(
  event: Extract<AgentEvent, { type: "task_started" }>,
  state: LoopTUIState,
  requestRender: () => void,
  currentContainer: () => ChildContainer,
): void {
  if (!state.toolIdToContainer.has(event.toolUseId)) {
    const container = currentContainer();
    container.addChild(new Text(dim(`┌ Agent: ${event.description}`), 0, 0));
    const subBox = new PipeBox();
    container.addChild(subBox);
    state.containerStack.push(subBox);
    state.toolIdToContainer.set(event.toolUseId, subBox);
    requestRender();
  }
}

function handleTaskDone(
  event: Extract<AgentEvent, { type: "task_done" }>,
  state: LoopTUIState,
  requestRender: () => void,
  currentContainer: () => ChildContainer,
): void {
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
  parent.addChild(new Text(dim(`└ ${event.status}: ${event.summary} (${meta.join(" · ")})`), 0, 0));
  requestRender();
}
