import { type Component, Text } from "@mariozechner/pi-tui";
import type { AgentEvent } from "../agents/types.js";
import { dim } from "../lib/ansi.js";
import { nextAgentColor, PipeBox } from "./components/pipe-box.js";
import { ToolLine } from "./components/tool-line.js";
import { formatTokenCount } from "./formatters.js";

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

export interface RunViewState {
  containerStack: ChildContainer[];
  toolIdToContainer: Map<string, ChildContainer>;
  toolIdToParentContainer: Map<string, ChildContainer>;
  backgroundAgentToolIds: Set<string>;
  textBlocks: Map<string, { textRef: Text; accumulated: string }>;
  thinkingIndicators: Map<string, { node: IndicatorNode; parent: ChildContainer }>;
}

export function handleTextDelta(
  event: Extract<AgentEvent, { type: "text_delta" }>,
  state: RunViewState,
  requestRender: () => void,
  containerForEvent: (parentToolUseId: string | null) => ChildContainer,
): void {
  const key = event.parentToolUseId ?? ROOT_KEY;
  const container = containerForEvent(event.parentToolUseId);
  const existing = state.textBlocks.get(key);
  if (existing) {
    existing.accumulated += event.text;
    existing.textRef.setText(formatAssistantText(existing.accumulated));
  } else {
    const accumulated = event.text;
    const textRef = new Text(formatAssistantText(accumulated), 0, 0);
    container.addChild(textRef);
    state.textBlocks.set(key, { textRef, accumulated });
  }
  requestRender();
}

function formatAssistantText(text: string): string {
  const lines = text.trimStart().split("\n");
  return lines
    .map((line, index) => {
      if (index === 0) return `${dim("›")} ${line}`;
      if (line.length === 0) return "";
      return `  ${line}`;
    })
    .join("\n");
}

export function handleToolStart(
  event: Extract<AgentEvent, { type: "tool_start" }>,
  state: RunViewState,
  requestRender: () => void,
  containerForEvent: (parentToolUseId: string | null) => ChildContainer,
): void {
  if (event.tool === "Task" || event.tool === "Agent") {
    const container = containerForEvent(event.parentToolUseId);
    const description = String(event.input?.description ?? event.input?.task ?? "");
    const model = event.input?.model;
    const modelSuffix = typeof model === "string" && model ? ` · ${model}` : "";
    const color = nextAgentColor();
    const subBox = new PipeBox(color);
    subBox.setHeader(dim(`agent  ${description}${modelSuffix}`));
    container.addChild(subBox);
    state.toolIdToContainer.set(event.toolId, subBox);
    state.toolIdToParentContainer.set(event.toolId, container);
    if (event.input?.run_in_background === true) {
      state.backgroundAgentToolIds.add(event.toolId);
    }
    requestRender();
    return;
  }

  const container = containerForEvent(event.parentToolUseId);
  container.addChild(new ToolLine(event.tool, event.input));
  requestRender();
}

export function handleTaskStarted(
  event: Extract<AgentEvent, { type: "task_started" }>,
  state: RunViewState,
  requestRender: () => void,
  currentContainer: () => ChildContainer,
): void {
  if (!state.toolIdToContainer.has(event.toolUseId)) {
    const container = currentContainer();
    const color = nextAgentColor();
    const subBox = new PipeBox(color);
    subBox.setHeader(dim(`agent  ${event.description}`));
    container.addChild(subBox);
    state.toolIdToContainer.set(event.toolUseId, subBox);
    state.toolIdToParentContainer.set(event.toolUseId, container);
    requestRender();
  }
}

export function handleTaskDone(
  event: Extract<AgentEvent, { type: "task_done" }>,
  state: RunViewState,
  requestRender: () => void,
  currentContainer: () => ChildContainer,
): void {
  const mapped = state.toolIdToContainer.get(event.toolUseId);
  const parent = state.toolIdToParentContainer.get(event.toolUseId) || currentContainer();
  state.toolIdToContainer.delete(event.toolUseId);
  state.toolIdToParentContainer.delete(event.toolUseId);
  state.backgroundAgentToolIds.delete(event.toolUseId);
  const durationSec = (event.durationMs / 1000).toFixed(1);
  const meta: string[] = [`${durationSec}s`];
  if (event.totalTokens != null) meta.push(`${formatTokenCount(event.totalTokens)} tokens`);
  const status = event.status.toLowerCase();
  const symbol = status.includes("fail") || status.includes("error") ? "✕" : "✓";
  const footerText = dim(`${symbol} ${status} ${event.summary} · ${meta.join(" · ")}`);
  if (mapped instanceof PipeBox) {
    mapped.setFooter(footerText);
  } else {
    parent.addChild(new Text(`${dim("└")} ${footerText}`, 0, 0));
  }
  requestRender();
}
