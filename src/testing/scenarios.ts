import type { Scenario } from "../agents/stub.js";

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

/** Read a file, edit it, then confirm the changes. */
export const READ_THEN_EDIT: Scenario = {
  model: "claude-sonnet-4-20250514",
  turns: [
    {
      text: "I'll read the file first and then make the edit.",
      toolCalls: [
        {
          tool: "Read",
          input: { file_path: "src/components/Header.tsx", limit: 50 },
          result:
            '     1\u2192import React from "react";\n     2\u2192\n     3\u2192export function Header() {\n     4\u2192  return <h1>My App</h1>;\n     5\u2192}',
        },
        {
          tool: "Edit",
          input: {
            file_path: "src/components/Header.tsx",
            old_string: "  return <h1>My App</h1>;",
            new_string:
              '  return (\n    <header>\n      <h1>My App</h1>\n      <nav>\n        <a href="/">Home</a>\n        <a href="/about">About</a>\n      </nav>\n    </header>\n  );',
          },
          result: "Successfully edited src/components/Header.tsx",
        },
      ],
    },
    {
      text: "I've updated the Header component to include a navigation bar with Home and About links wrapped in a semantic header element.",
    },
  ],
  cost: 0.012,
  duration: 8500,
};

/** Multiple tool calls in a single turn. */
export const MULTI_TOOL_TURN: Scenario = {
  model: "claude-sonnet-4-20250514",
  turns: [
    {
      text: "I'll check the project structure and test configuration.",
      toolCalls: [
        {
          tool: "Bash",
          input: { command: "ls -la src/" },
          result:
            "total 24\ndrwxr-xr-x  5 user  staff  160 Mar 15 10:00 .\ndrwxr-xr-x  8 user  staff  256 Mar 15 10:00 ..\n-rw-r--r--  1 user  staff  420 Mar 15 10:00 index.ts\n-rw-r--r--  1 user  staff  180 Mar 15 10:00 utils.ts\ndrwxr-xr-x  3 user  staff   96 Mar 15 10:00 lib",
        },
        {
          tool: "Read",
          input: { file_path: "package.json" },
          result:
            '{\n  "name": "my-project",\n  "scripts": {\n    "test": "bun test",\n    "build": "bun build src/index.ts --outdir dist"\n  }\n}',
        },
        {
          tool: "Read",
          input: { file_path: "tsconfig.json" },
          result:
            '{\n  "compilerOptions": {\n    "target": "ESNext",\n    "module": "ESNext",\n    "strict": true\n  }\n}',
        },
      ],
    },
    {
      text: "The project has a clean structure with src/index.ts as the entry point. It uses Bun for testing and building, and TypeScript is configured in strict mode with ESNext target.",
    },
  ],
  cost: 0.008,
  duration: 5200,
};

/** Task tool with nested subagent turns. */
export const NESTED_SUBAGENT: Scenario = {
  model: "claude-sonnet-4-20250514",
  turns: [
    {
      text: "I'll delegate the code review to a subagent for a thorough check.",
      toolCalls: [
        {
          tool: "Agent",
          input: {
            description:
              "Review src/lib/parser.ts for correctness, edge cases, and code style issues",
            prompt: "Review the parser module for correctness, edge cases, and code style issues",
          },
          result:
            "Review complete. Found 1 issue: the error message in line 42 is missing the actual invalid token. Everything else looks good.",
          subagentDurationMs: 8500,
          subagent: [
            {
              text: "I'll review the parser module.",
              toolCalls: [
                {
                  tool: "Read",
                  input: { file_path: "src/lib/parser.ts" },
                  result:
                    'export function parse(args: string[]): Step[] {\n  // ... parser implementation\n  if (!isValid(token)) {\n    throw new Error("Invalid token");\n  }\n}',
                },
              ],
            },
            {
              text: "The parser looks well-structured. I found one issue: the error message on line 42 doesn't include the invalid token value, which makes debugging harder. Everything else follows good patterns.",
            },
          ],
        },
      ],
    },
    {
      text: "The review found one minor issue in the parser: the error message for invalid tokens should include the actual token value for easier debugging. I'll fix that now.",
      toolCalls: [
        {
          tool: "Edit",
          input: {
            file_path: "src/lib/parser.ts",
            old_string: '    throw new Error("Invalid token");',
            new_string: '    throw new Error(`Invalid token: "${token}"`);',
          },
          result: "Successfully edited src/lib/parser.ts",
        },
      ],
    },
    {
      text: "Fixed the error message to include the invalid token value. The review is complete.",
    },
  ],
  cost: 0.035,
  duration: 22000,
};

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
