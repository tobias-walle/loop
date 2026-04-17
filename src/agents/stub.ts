import type { AgentAdapter, AgentEvent, AgentSession, AgentSpawnOptions } from "./types.js";

export type Turn = {
  text?: string;
  toolCalls?: ToolCall[];
};

export type ToolCall = {
  tool: string;
  input: Record<string, unknown>;
  result: string;
  /** Nested turns emitted between task_started and task_done for Agent/Task tools. */
  subagent?: Turn[];
  /** Duration reported by the task (ms). Defaults to 0. */
  subagentDurationMs?: number;
};

export type Scenario = {
  model?: string;
  turns: Turn[];
  cost?: number;
  duration?: number;
  retries?: { attempt: number; maxRetries: number; delayMs: number; error: string }[];
};

let toolIdCounter = 0;

function generateToolId(): string {
  toolIdCounter++;
  return `toolu_stub_${toolIdCounter}`;
}

/** Metadata for a subagent tool call, used for interleaved emission. */
type SubagentInfo = {
  toolId: string;
  taskId: string;
  call: ToolCall;
  description: string;
  innerEvents: AgentEvent[];
};

/**
 * Emit events for parallel subagent tool calls in interleaved order,
 * matching real Claude behavior: all tool_starts → all task_starteds →
 * round-robin inner events → all task_dones → all tool_dones.
 */
function emitParallelSubagents(
  agents: SubagentInfo[],
  parentToolUseId: string | null,
): AgentEvent[] {
  const events: AgentEvent[] = [];

  // Phase 1: all tool_starts
  for (const a of agents) {
    events.push({
      type: "tool_start",
      toolId: a.toolId,
      tool: a.call.tool,
      input: a.call.input,
      parentToolUseId,
    });
  }

  // Phase 2: all task_starteds
  for (const a of agents) {
    events.push({
      type: "task_started",
      taskId: a.taskId,
      toolUseId: a.toolId,
      description: a.description,
      prompt: typeof a.call.input.prompt === "string" ? a.call.input.prompt : a.description,
    });
  }

  // Phase 3: round-robin inner events
  const maxLen = Math.max(...agents.map((a) => a.innerEvents.length));
  for (let i = 0; i < maxLen; i++) {
    for (const a of agents) {
      if (i < a.innerEvents.length) {
        events.push(a.innerEvents[i]);
      }
    }
  }

  // Phase 4: all task_dones
  for (const a of agents) {
    events.push({
      type: "task_done",
      taskId: a.taskId,
      toolUseId: a.toolId,
      status: "completed",
      summary: a.description,
      durationMs: a.call.subagentDurationMs ?? 0,
    });
  }

  // Phase 5: all tool_dones
  for (const a of agents) {
    events.push({
      type: "tool_done",
      toolId: a.toolId,
      result: a.call.result,
      parentToolUseId,
    });
  }

  return events;
}

function collectTurnEvents(turns: Turn[], parentToolUseId: string | null): AgentEvent[] {
  const events: AgentEvent[] = [];

  for (const turn of turns) {
    if (turn.text != null) {
      events.push({
        type: "text_delta",
        text: turn.text,
        parentToolUseId,
      });
      events.push({
        type: "text_done",
        text: turn.text,
        parentToolUseId,
      });
    }

    if (turn.toolCalls) {
      // Partition into subagent calls (parallel) and regular calls
      const parallelSubagents: SubagentInfo[] = [];
      const regularCalls: ToolCall[] = [];

      for (const call of turn.toolCalls) {
        if (call.subagent) {
          const toolId = generateToolId();
          const taskId = `task_stub_${toolIdCounter}`;
          const description =
            typeof call.input.description === "string"
              ? call.input.description
              : typeof call.input.task === "string"
                ? call.input.task
                : call.tool;
          parallelSubagents.push({
            toolId,
            taskId,
            call,
            description,
            innerEvents: collectTurnEvents(call.subagent, toolId),
          });
        } else {
          regularCalls.push(call);
        }
      }

      // Emit regular tool calls sequentially
      for (const call of regularCalls) {
        const toolId = generateToolId();
        events.push({
          type: "tool_start",
          toolId,
          tool: call.tool,
          input: call.input,
          parentToolUseId,
        });
        events.push({
          type: "tool_done",
          toolId,
          result: call.result,
          parentToolUseId,
        });
      }

      // Emit subagent calls interleaved (even if only one, same code path)
      if (parallelSubagents.length > 0) {
        events.push(...emitParallelSubagents(parallelSubagents, parentToolUseId));
      }
    }
  }

  return events;
}

export function createStubAdapter(scenarios: Scenario | Scenario[]): AgentAdapter {
  const scenarioList = Array.isArray(scenarios) ? [...scenarios] : null;
  const singleScenario = Array.isArray(scenarios) ? null : scenarios;
  let spawnIndex = 0;

  return {
    spawn(_prompt: string, _opts?: AgentSpawnOptions): AgentSession {
      const picked = singleScenario ?? scenarioList?.[spawnIndex++];
      if (!picked) {
        throw new Error("No more scenarios available in stub adapter");
      }
      // Bind to a const so TypeScript knows it's non-null inside the generator
      const scenario = picked;

      const messages: string[] = [];

      async function* generateEvents(): AsyncGenerator<AgentEvent> {
        yield {
          type: "session_start",
          model: scenario.model ?? "stub-model",
          sessionId: `stub-session-${spawnIndex}`,
          tools: ["Bash", "Read", "Write", "Edit"],
        };

        // Emit retry events if configured
        if (scenario.retries) {
          for (const retry of scenario.retries) {
            yield {
              type: "retry",
              attempt: retry.attempt,
              maxRetries: retry.maxRetries,
              delayMs: retry.delayMs,
              error: retry.error,
            };
          }
        }

        const turnEvents = collectTurnEvents(scenario.turns, null);
        for (const event of turnEvents) {
          yield event;
        }

        // Collect the final text from the last turn
        const lastTurn = scenario.turns[scenario.turns.length - 1];
        const resultText = lastTurn?.text ?? "";

        yield {
          type: "done",
          result: resultText,
          costUsd: scenario.cost ?? 0,
          durationMs: scenario.duration ?? 0,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
          },
        };
      }

      return {
        events: generateEvents(),
        exited: Promise.resolve(),

        sendMessage(text: string): void {
          messages.push(text);
        },

        abort(): void {
          // no-op
        },
      };
    },
  };
}
