import type { Scenario } from "../../agents/stub.js";

/** Single text response with no tool calls. */
export const SIMPLE_TEXT: Scenario = {
  model: "claude-sonnet-4-20250514",
  turns: [
    {
      text: "The project uses TypeScript with Bun as the runtime. The entry point is src/index.ts and it exports a CLI tool called 'loop'.",
    },
  ],
  cost: 0.003,
  duration: 2400,
};

/** Scenario where execution results in an error. */
export const ERROR_EXECUTION: Scenario = {
  model: "claude-sonnet-4-20250514",
  turns: [
    {
      text: "I'll try to read the configuration file.",
      toolCalls: [
        {
          tool: "Read",
          input: { file_path: "config/settings.yaml" },
          result: "Error: ENOENT: no such file or directory, open 'config/settings.yaml'",
        },
      ],
    },
    {
      text: "The configuration file does not exist. Cannot proceed without it.",
    },
  ],
  cost: 0.002,
  duration: 1500,
};
