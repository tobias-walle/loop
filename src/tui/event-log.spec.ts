import { describe, expect, test } from "bun:test";
import {
  formatCompletion,
  formatError,
  formatRetry,
  formatStepHeader,
  formatToolLine,
  formatUserMessage,
} from "./event-log.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching control chars
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function strip(s: string): string {
  return s.replace(ANSI_RE, "");
}

describe("formatToolLine", () => {
  test("formats Read with file path", () => {
    const line = strip(formatToolLine("Read", { file_path: "src/index.ts" }));
    expect(line).toContain("Read");
    expect(line).toContain("src/index.ts");
  });

  test("formats Write with file path", () => {
    const line = strip(formatToolLine("Write", { file_path: "src/app.ts" }));
    expect(line).toContain("Write");
    expect(line).toContain("src/app.ts");
  });

  test("formats Edit with path key", () => {
    const line = strip(formatToolLine("Edit", { path: "config.json" }));
    expect(line).toContain("Edit");
    expect(line).toContain("config.json");
  });

  test("formats Bash with command", () => {
    const line = strip(formatToolLine("Bash", { command: "npm test -- --coverage" }));
    expect(line).toContain("Bash");
    expect(line).toContain("npm test -- --coverage");
  });

  test("formats Search with query and path", () => {
    const line = strip(formatToolLine("Search", { query: "error handling", path: "src/" }));
    expect(line).toContain("Search");
    expect(line).toContain('"error handling"');
    expect(line).toContain("in src/");
  });

  test("formats Grep with pattern and directory", () => {
    const line = strip(formatToolLine("Grep", { pattern: "TODO", directory: "lib/" }));
    expect(line).toContain("Grep");
    expect(line).toContain('"TODO"');
    expect(line).toContain("in lib/");
  });

  test("formats Search without path", () => {
    const line = strip(formatToolLine("Search", { query: "test" }));
    expect(line).toContain("Search");
    expect(line).toContain('"test"');
    expect(line).not.toContain("in ");
  });

  test("formats Task as subagent", () => {
    const line = strip(formatToolLine("Task", { task: "Review all modules" }));
    expect(line).toContain("Subagent");
    expect(line).toContain('"Review all modules"');
  });

  test("formats unknown tool with first string arg", () => {
    const line = strip(formatToolLine("CustomTool", { name: "hello" }));
    expect(line).toContain("CustomTool");
    expect(line).toContain("hello");
  });

  test("formats unknown tool with no string args", () => {
    const line = strip(formatToolLine("CustomTool", { count: 42 }));
    expect(line).toContain("CustomTool");
  });

  test("truncates long bash commands", () => {
    const longCmd = `npm run build && npm run test && npm run lint && ${"x".repeat(200)}`;
    const line = strip(formatToolLine("Bash", { command: longCmd }, 60));
    expect(line.length).toBeLessThan(longCmd.length);
    expect(line).toContain("...");
  });
});

describe("formatStepHeader", () => {
  test("formats basic step header", () => {
    const header = strip(formatStepHeader(1, 3, "Create an about page"));
    expect(header).toContain("Step 1/3");
    expect(header).toContain("Create an about page");
    expect(header).toContain("───");
  });

  test("includes iteration when provided", () => {
    const header = strip(formatStepHeader(2, 3, "Review", 3));
    expect(header).toContain("iteration 3");
  });

  test("includes iteration and max when both provided", () => {
    const header = strip(formatStepHeader(2, 3, "Review", 3, 10));
    expect(header).toContain("iteration 3/10");
  });
});

describe("formatCompletion", () => {
  test("formats done with duration in seconds", () => {
    const text = strip(formatCompletion("done", 45000));
    expect(text).toContain("Done");
    expect(text).toContain("45s");
  });

  test("formats done with duration in minutes and seconds", () => {
    const text = strip(formatCompletion("done", 83000));
    expect(text).toContain("1m 23s");
  });

  test("formats loop_done with iterations", () => {
    const text = strip(formatCompletion("loop_done", 221000, 2));
    expect(text).toContain("LOOP_DONE");
    expect(text).toContain("2 iterations");
  });

  test("formats loop_done without iterations", () => {
    const text = strip(formatCompletion("loop_done", 10000));
    expect(text).toContain("LOOP_DONE");
  });

  test("formats max_reached with iterations", () => {
    const text = strip(formatCompletion("max_reached", 60000, 10));
    expect(text).toContain("MAX reached");
    expect(text).toContain("10 iterations");
  });
});

describe("formatRetry", () => {
  test("formats retry with attempt info", () => {
    const text = strip(formatRetry(1, 10, "rate_limit"));
    expect(text).toContain("Retry");
    expect(text).toContain("1/10");
    expect(text).toContain("rate_limit");
  });
});

describe("formatError", () => {
  test("formats error message", () => {
    const text = strip(formatError("Connection failed"));
    expect(text).toContain("Error");
    expect(text).toContain("Connection failed");
  });
});

describe("formatUserMessage", () => {
  test("formats user message", () => {
    const text = strip(formatUserMessage("fix the CSS"));
    expect(text).toContain("👤");
    expect(text).toContain("fix the CSS");
  });
});
