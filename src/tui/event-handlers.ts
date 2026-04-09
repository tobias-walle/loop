import { type Component, Text } from "@mariozechner/pi-tui";
import type { AgentEvent } from "../agents/types.js";
import { dim } from "../lib/ansi.js";
import { PipeBox } from "./components/pipe-box.js";
import { formatTokenCount, formatToolLine } from "./formatters.js";

/** Any component that can hold children (Container, PipeBox, etc.) */
export type ChildContainer = Component & {
  children: Component[];
  addChild(c: Component): void;
  removeChild(c: Component): void;
};

/** A node with stop/setText methods (e.g. ThinkingIndicator). */
export type IndicatorNode = Component & { stop(): void; setText(t: string): void };

export interface LoopTUIState {
  containerStack: ChildContainer[];
  toolIdToContainer: Map<string, ChildContainer>;
  textBlocks: Map<string, { textRef: Text; accumulated: string }>;
  thinkingIndicator: { node: IndicatorNode; parent: ChildContainer } | null;
}

export function handleTextDelta(
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
    existing.textRef.setText(`💬 ${existing.accumulated.trimStart()}`);
  } else {
    const accumulated = event.text;
    const textRef = new Text(`💬 ${accumulated.trimStart()}`, 0, 0);
    container.addChild(textRef);
    state.textBlocks.set(key, { textRef, accumulated });
  }
  requestRender();
}

export function handleToolStart(
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

export function handleTaskStarted(
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

export function handleTaskDone(
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
