import type { AgentAdapter, AgentEvent, AgentSession, AgentSpawnOptions } from "./types.js";

export type Turn = {
  text?: string;
  toolCalls?: ToolCall[];
};

export type ToolCall = {
  tool: string;
  input: Record<string, unknown>;
  result: string;
  subagent?: Turn[];
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
      for (const call of turn.toolCalls) {
        const toolId = generateToolId();

        events.push({
          type: "tool_start",
          toolId,
          tool: call.tool,
          input: call.input,
          parentToolUseId,
        });

        // If this is a subagent call, emit nested turn events
        if (call.subagent) {
          events.push(...collectTurnEvents(call.subagent, toolId));
        }

        events.push({
          type: "tool_done",
          toolId,
          result: call.result,
          parentToolUseId,
        });
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
