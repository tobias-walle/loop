import { type Container, Spacer, Text } from "@mariozechner/pi-tui";
import type { AgentEvent } from "../agents/types.js";
import type { AgentArgs } from "../lib/agent-args.js";
import { dim } from "../lib/ansi.js";
import type { RunSummary, TokenUsage } from "../lib/types.js";
import { PipeBox } from "./components/pipe-box.js";
import { appendRunBoundary } from "./components/run-boundary.js";
import type { ChildContainer, RunViewState } from "./event-handlers.js";
import {
  handleTaskDone,
  handleTaskStarted,
  handleTextDelta,
  handleToolStart,
  ROOT_KEY,
} from "./event-handlers.js";
import {
  formatCompletion,
  formatError,
  formatInterruption,
  formatRetry,
  formatRunSummary,
  formatStepHeaderLines,
} from "./formatters.js";
import { createThinkingIndicators } from "./thinking-indicators.js";

export type { RunViewState } from "./event-handlers.js";

type ShowStepHeader = (
  step: number,
  totalSteps: number,
  task: string,
  iteration?: number,
  max?: number,
  model?: string,
  agent?: string,
  agentArgs?: AgentArgs,
) => void;

export function createEventRouter(
  root: Container,
  requestRender: () => void,
): {
  state: RunViewState;
  handleEvent: (event: AgentEvent, stepIndex: number) => void;
  finishActiveSession: () => void;
  showInterruption: () => void;
  showStepHeader: ShowStepHeader;
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
  const state: RunViewState = {
    containerStack: [root],
    toolIdToContainer: new Map(),
    toolIdToParentContainer: new Map(),
    backgroundAgentToolIds: new Set(),
    textBlocks: new Map(),
    thinkingIndicators: new Map(),
  };

  let sessionDone = false;
  const thinking = createThinkingIndicators(
    state.thinkingIndicators,
    requestRender,
    () => !sessionDone,
  );

  function currentContainer(): ChildContainer {
    return state.containerStack[state.containerStack.length - 1];
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
    agent?: string;
    agentArgs?: AgentArgs;
    metaNode: Text;
    taskNode: Text;
  } | null = null;

  function handleEvent(event: AgentEvent, _stepIndex: number): void {
    if (event.type === "session_start" && headerInfo && headerInfo.model !== event.model) {
      headerInfo.model = event.model;
      const { step, totalSteps, task, iteration, max, model, agent, agentArgs } = headerInfo;
      const [metaLine, taskLine] = formatStepHeaderLines(
        step,
        totalSteps,
        task,
        iteration,
        max,
        model,
        agent,
        agentArgs,
      );
      headerInfo.metaNode.setText(metaLine);
      headerInfo.taskNode.setText(taskLine);
      requestRender();
    }

    if (event.type === "text_delta" || event.type === "tool_start") {
      const key = event.parentToolUseId ?? ROOT_KEY;
      if (thinking.has(key)) {
        thinking.remove(key);
        requestRender();
      }
    }
    if (event.type === "error") {
      if (thinking.has(ROOT_KEY)) {
        thinking.remove(ROOT_KEY);
        requestRender();
      }
    }

    switch (event.type) {
      case "text_delta":
        handleTextDelta(event, state, requestRender, containerForEvent);
        break;
      case "text_done": {
        const key = event.parentToolUseId ?? ROOT_KEY;
        if (!state.textBlocks.has(key) && event.text) {
          handleTextDelta(
            { type: "text_delta", text: event.text, parentToolUseId: event.parentToolUseId },
            state,
            requestRender,
            containerForEvent,
          );
        }
        state.textBlocks.delete(key);
        if (key === ROOT_KEY) {
          const container = containerForEvent(event.parentToolUseId);
          thinking.add(key, container, "thinking");
        }
        break;
      }
      case "tool_start":
        handleToolStart(event, state, requestRender, containerForEvent);
        break;
      case "tool_done": {
        const subContainer = state.toolIdToContainer.get(event.toolId);
        if (subContainer instanceof PipeBox) {
          thinking.remove(event.toolId);
          const status = state.backgroundAgentToolIds.delete(event.toolId)
            ? "↗ background"
            : "✓ done";
          subContainer.setFooter(dim(status));
          state.toolIdToContainer.delete(event.toolId);
          state.toolIdToParentContainer.delete(event.toolId);
          requestRender();
        }
        const key = event.parentToolUseId ?? ROOT_KEY;
        if (key === ROOT_KEY) {
          const container = containerForEvent(event.parentToolUseId);
          thinking.add(key, container);
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
      case "task_started":
        handleTaskStarted(event, state, requestRender, currentContainer);
        break;
      case "task_done":
        thinking.remove(event.toolUseId);
        handleTaskDone(event, state, requestRender, currentContainer);
        break;
      case "done":
        sessionDone = true;
        thinking.removeAll();
        break;
      default:
        break;
    }
  }

  function finishActiveSession(): void {
    sessionDone = true;
    thinking.removeAll();
  }

  function showInterruption(): void {
    finishActiveSession();
    appendRunBoundary(root, formatInterruption());
    requestRender();
  }

  function showStepHeader(
    step: number,
    totalSteps: number,
    task: string,
    iteration?: number,
    max?: number,
    model?: string,
    agent?: string,
    agentArgs?: AgentArgs,
  ): void {
    const [metaLine, taskLine] = formatStepHeaderLines(
      step,
      totalSteps,
      task,
      iteration,
      max,
      model,
      agent,
      agentArgs,
    );
    state.containerStack.length = 1;
    state.toolIdToContainer.clear();
    state.toolIdToParentContainer.clear();
    state.backgroundAgentToolIds.clear();
    state.textBlocks.clear();
    thinking.removeAll();
    sessionDone = false;
    root.addChild(new Spacer());
    const metaNode = new Text(metaLine, 0, 0);
    const taskNode = new Text(taskLine, 0, 0);
    root.addChild(metaNode);
    root.addChild(taskNode);
    root.addChild(new Spacer());
    headerInfo = {
      step,
      totalSteps,
      task,
      iteration,
      max,
      model,
      agent,
      agentArgs,
      metaNode,
      taskNode,
    };
    thinking.add(ROOT_KEY, root);
    requestRender();
  }

  function showCompletion(
    type: "done" | "loop_done" | "max_reached",
    durationMs: number,
    iterations?: number,
    costUsd?: number,
    usage?: TokenUsage,
  ): void {
    appendRunBoundary(root, formatCompletion(type, durationMs, iterations, costUsd, usage));
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
    finishActiveSession,
    showInterruption,
    showStepHeader,
    showCompletion,
    showSessionInfo,
    showRunSummary,
  };
}
