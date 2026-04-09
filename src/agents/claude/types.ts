// Claude NDJSON event types (internal to the adapter)
export type ClaudeEvent =
  | {
      type: "system";
      subtype: "init";
      session_id: string;
      tools: string[];
      model: string;
    }
  | {
      type: "system";
      subtype: "api_retry";
      attempt: number;
      max_retries: number;
      retry_delay_ms: number;
      error: string;
    }
  | {
      type: "system";
      subtype: "task_started";
      task_id: string;
      tool_use_id: string;
      description: string;
      prompt: string;
    }
  | {
      type: "system";
      subtype: "task_notification";
      task_id: string;
      tool_use_id: string;
      status: string;
      summary: string;
      usage: { duration_ms: number; total_tokens?: number };
    }
  | {
      type: "system";
      subtype: "task_progress";
      task_id: string;
      tool_use_id: string;
    }
  | {
      type: "stream_event";
      event: StreamEvent;
      parent_tool_use_id: string | null;
    }
  | {
      type: "user";
      message: {
        role: "user";
        content: Array<{
          tool_use_id: string;
          type: "tool_result";
          content: string;
        }>;
      };
    }
  | {
      type: "rate_limit_event";
      rate_limit_info: {
        status: string;
        resetsAt: number;
      };
    }
  | {
      type: "result";
      subtype: string;
      is_error: boolean;
      result: string;
      duration_ms: number;
      total_cost_usd: number;
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    }
  | {
      type: "assistant";
      parent_tool_use_id: string | null;
      message: {
        model?: string;
        content: Array<
          | { type: "text"; text: string }
          | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
        >;
      };
    };

export type StreamEvent =
  | { type: "message_start"; message: { model: string; id: string } }
  | {
      type: "content_block_start";
      index: number;
      content_block:
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: object };
    }
  | {
      type: "content_block_delta";
      index: number;
      delta:
        | { type: "text_delta"; text: string }
        | { type: "input_json_delta"; partial_json: string };
    }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason: string } }
  | { type: "message_stop" };

export type BlockState =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; id: string; name: string; inputJson: string };
