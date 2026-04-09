import type { Scenario } from "../../agents/stub.js";

/** Two scenarios for a ralph loop: first continues, second is done. */
export const RALPH_LOOP_TWO_ITERS: Scenario[] = [
  {
    model: "claude-sonnet-4-20250514",
    turns: [
      {
        text: "I'll check the test suite and fix any failures.",
        toolCalls: [
          {
            tool: "Bash",
            input: { command: "bun test 2>&1" },
            result:
              "bun test v1.3.0\n\n src/lib/parser.spec.ts:\n   PASS: parses single task\n   PASS: parses sequential tasks\n   FAIL: validates --max without --until\n   FAIL: handles empty input\n\n 2 pass, 2 fail",
          },
          {
            tool: "Edit",
            input: {
              file_path: "src/lib/parser.ts",
              old_string: "if (flags.max && !flags.until) return;",
              new_string:
                'if (flags.max && !flags.until) throw new Error("--max requires --until");',
            },
            result: "Successfully edited src/lib/parser.ts",
          },
        ],
      },
      {
        text: "Fixed the --max validation. One test is still failing (empty input handling). Need another iteration.\n\nLOOP_CONTINUE: Fixed --max validation, empty input handling still needs work",
      },
    ],
    cost: 0.015,
    duration: 12000,
  },
  {
    model: "claude-sonnet-4-20250514",
    turns: [
      {
        text: "Continuing with the remaining test failure.",
        toolCalls: [
          {
            tool: "Edit",
            input: {
              file_path: "src/lib/parser.ts",
              old_string: "export function parse(args: string[]): Step[] {",
              new_string:
                "export function parse(args: string[]): Step[] {\n  if (args.length === 0) return [];",
            },
            result: "Successfully edited src/lib/parser.ts",
          },
          {
            tool: "Bash",
            input: { command: "bun test 2>&1" },
            result:
              "bun test v1.3.0\n\n src/lib/parser.spec.ts:\n   PASS: parses single task\n   PASS: parses sequential tasks\n   PASS: validates --max without --until\n   PASS: handles empty input\n\n 4 pass, 0 fail",
          },
        ],
      },
      {
        text: "All tests pass now. Both issues are resolved.\n\nLOOP_DONE",
      },
    ],
    cost: 0.011,
    duration: 9000,
  },
];

/** Scenario that encounters retry events (rate limiting). */
export const RATE_LIMITED: Scenario = {
  model: "claude-sonnet-4-20250514",
  retries: [
    {
      attempt: 1,
      maxRetries: 10,
      delayMs: 551,
      error: "rate_limit",
    },
    {
      attempt: 2,
      maxRetries: 10,
      delayMs: 1102,
      error: "rate_limit",
    },
  ],
  turns: [
    {
      text: "After a brief delay, here is the answer. The main export from src/index.ts is the CLI entry point that parses arguments and starts the loop runner.",
    },
  ],
  cost: 0.004,
  duration: 6800,
};
