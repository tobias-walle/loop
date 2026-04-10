import { type Component, Text } from "@mariozechner/pi-tui";
import type { AgentEvent } from "../agents/types.js";
import { dim } from "../lib/ansi.js";
import { PipeBox, nextAgentColor } from "./components/pipe-box.js";
import { formatTokenCount, formatToolLine } from "./formatters.js";

/** Key used for the root-level context in maps keyed by parentToolUseId. */
export const ROOT_KEY = "__root__";

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
  toolIdToParentContainer: Map<string, ChildContainer>;
  textBlocks: Map<string, { textRef: Text; accumulated: string }>;
  thinkingIndicators: Map<string, { node: IndicatorNode; parent: ChildContainer }>;
}

export function handleTextDelta(
  event: Extract<AgentEvent, { type: "text_delta" }>,
  state: LoopTUIState,
  requestRender: () => void,
  containerForEvent: (parentToolUseId: string | null) => ChildContainer,
): void {
  const key = event.parentToolUseId ?? ROOT_KEY;
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
    const color = nextAgentColor();
    const subBox = new PipeBox(color);
    subBox.setHeader(dim(`${event.tool}: ${description}${modelSuffix}`));
    container.addChild(subBox);
    state.toolIdToContainer.set(event.toolId, subBox);
    state.toolIdToParentContainer.set(event.toolId, container);
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
    const color = nextAgentColor();
    const subBox = new PipeBox(color);
    subBox.setHeader(dim(`Agent: ${event.description}`));
    container.addChild(subBox);
    state.toolIdToContainer.set(event.toolUseId, subBox);
    state.toolIdToParentContainer.set(event.toolUseId, container);
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
  const parent = state.toolIdToParentContainer.get(event.toolUseId) || currentContainer();
  state.toolIdToContainer.delete(event.toolUseId);
  state.toolIdToParentContainer.delete(event.toolUseId);
  const durationSec = (event.durationMs / 1000).toFixed(1);
  const meta: string[] = [`${durationSec}s`];
  if (event.totalTokens != null) meta.push(`${formatTokenCount(event.totalTokens)} tokens`);
  const footerText = dim(`${event.status}: ${event.summary} (${meta.join(" · ")})`);
  if (mapped instanceof PipeBox) {
    mapped.setFooter(footerText);
  } else {
    parent.addChild(new Text(dim(`└ ${footerText}`), 0, 0));
  }
  requestRender();
}
