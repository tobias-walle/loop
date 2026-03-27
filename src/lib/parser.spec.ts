import { describe, expect, test } from "bun:test";
import { ParseError, parseArgs } from "./parser";

describe("parseArgs", () => {
  describe("single task", () => {
    test("parses a single task string", () => {
      const result = parseArgs(["Create an about page"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Create an about page" }],
      });
    });
  });

  describe("sequential tasks", () => {
    test("parses multiple tasks in sequence", () => {
      const result = parseArgs(["task1", "task2", "task3"]);
      expect(result).toEqual({
        steps: [
          { type: "task", task: "task1" },
          { type: "task", task: "task2" },
          { type: "task", task: "task3" },
        ],
      });
    });
  });

  describe("init subcommand", () => {
    test("parses init command", () => {
      const result = parseArgs(["init"]);
      expect(result).toEqual({
        steps: [],
        command: "init",
      });
    });
  });

  describe("groups", () => {
    test("parses a group of tasks", () => {
      const result = parseArgs(["[", "Review code", "Fix issues", "]"]);
      expect(result).toEqual({
        steps: [{ type: "group", tasks: ["Review code", "Fix issues"] }],
      });
    });

    test("parses a group with a single task", () => {
      const result = parseArgs(["[", "Review code", "]"]);
      expect(result).toEqual({
        steps: [{ type: "group", tasks: ["Review code"] }],
      });
    });

    test("parses task before a group", () => {
      const result = parseArgs(["Create page", "[", "Review", "Fix", "]"]);
      expect(result).toEqual({
        steps: [
          { type: "task", task: "Create page" },
          { type: "group", tasks: ["Review", "Fix"] },
        ],
      });
    });

    test("parses task after a group", () => {
      const result = parseArgs(["[", "Review", "Fix", "]", "Deploy"]);
      expect(result).toEqual({
        steps: [
          { type: "group", tasks: ["Review", "Fix"] },
          { type: "task", task: "Deploy" },
        ],
      });
    });
  });

  describe("flags on tasks", () => {
    test("--until on a task", () => {
      const result = parseArgs(["Work on tasks", "--until", "All done"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Work on tasks", until: "All done" }],
      });
    });

    test("--repeat on a task", () => {
      const result = parseArgs(["Run tests", "--repeat", "3"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Run tests", repeat: 3 }],
      });
    });

    test("--until + --max on a task", () => {
      const result = parseArgs(["Fix bugs", "--until", "No bugs left", "--max", "10"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Fix bugs", until: "No bugs left", max: 10 }],
      });
    });

    test("--max + --until order does not matter", () => {
      const result = parseArgs(["Fix bugs", "--max", "5", "--until", "Clean"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Fix bugs", until: "Clean", max: 5 }],
      });
    });
  });

  describe("flags on groups", () => {
    test("--repeat on a group", () => {
      const result = parseArgs(["[", "Review", "Fix", "]", "--repeat", "3"]);
      expect(result).toEqual({
        steps: [{ type: "group", tasks: ["Review", "Fix"], repeat: 3 }],
      });
    });

    test("--until on a group", () => {
      const result = parseArgs(["[", "Review", "Fix", "]", "--until", "No issues"]);
      expect(result).toEqual({
        steps: [{ type: "group", tasks: ["Review", "Fix"], until: "No issues" }],
      });
    });

    test("--until + --max on a group", () => {
      const result = parseArgs(["[", "Review", "Fix", "]", "--until", "Clean", "--max", "10"]);
      expect(result).toEqual({
        steps: [
          {
            type: "group",
            tasks: ["Review", "Fix"],
            until: "Clean",
            max: 10,
          },
        ],
      });
    });
  });

  describe("mixed sequences", () => {
    test("sequential task + grouped task with flags", () => {
      const result = parseArgs([
        "Create page",
        "[",
        "Review",
        "Fix",
        "]",
        "--repeat",
        "3",
        "[",
        "Polish",
        "]",
        "--until",
        "Perfect",
        "--max",
        "5",
      ]);
      expect(result).toEqual({
        steps: [
          { type: "task", task: "Create page" },
          { type: "group", tasks: ["Review", "Fix"], repeat: 3 },
          {
            type: "group",
            tasks: ["Polish"],
            until: "Perfect",
            max: 5,
          },
        ],
      });
    });

    test("task with until followed by plain task", () => {
      const result = parseArgs(["Fix bugs", "--until", "Clean", "Deploy"]);
      expect(result).toEqual({
        steps: [
          { type: "task", task: "Fix bugs", until: "Clean" },
          { type: "task", task: "Deploy" },
        ],
      });
    });
  });

  describe("validation errors", () => {
    test("empty args throws", () => {
      expect(() => parseArgs([])).toThrow(ParseError);
      expect(() => parseArgs([])).toThrow("No arguments provided");
    });

    test("--max without --until throws", () => {
      expect(() => parseArgs(["task", "--max", "5"])).toThrow(ParseError);
      expect(() => parseArgs(["task", "--max", "5"])).toThrow(
        "--max can only be used with --until",
      );
    });

    test("--repeat + --until throws", () => {
      expect(() => parseArgs(["task", "--repeat", "3", "--until", "done"])).toThrow(ParseError);
      expect(() => parseArgs(["task", "--repeat", "3", "--until", "done"])).toThrow(
        "--repeat and --until cannot be combined",
      );
    });

    test("--repeat + --max throws", () => {
      expect(() => parseArgs(["task", "--repeat", "3", "--max", "5"])).toThrow(ParseError);
      expect(() => parseArgs(["task", "--repeat", "3", "--max", "5"])).toThrow(
        "--repeat and --max cannot be combined",
      );
    });

    test("flag at start with no preceding task throws", () => {
      expect(() => parseArgs(["--until", "done"])).toThrow(ParseError);
      expect(() => parseArgs(["--until", "done"])).toThrow(
        'Flag "--until" has no preceding task or group',
      );
    });

    test("--repeat 0 throws", () => {
      expect(() => parseArgs(["task", "--repeat", "0"])).toThrow(ParseError);
      expect(() => parseArgs(["task", "--repeat", "0"])).toThrow(
        "--repeat requires a positive integer",
      );
    });

    test("--max 0 throws", () => {
      expect(() => parseArgs(["task", "--max", "0", "--until", "done"])).toThrow(ParseError);
      expect(() => parseArgs(["task", "--max", "0", "--until", "done"])).toThrow(
        "--max requires a positive integer",
      );
    });

    test("--repeat with negative number throws", () => {
      expect(() => parseArgs(["task", "--repeat", "-1"])).toThrow(
        "--repeat requires a positive integer",
      );
    });

    test("--repeat with non-number throws", () => {
      expect(() => parseArgs(["task", "--repeat", "abc"])).toThrow(
        '--repeat requires a positive integer, got "abc"',
      );
    });

    test("--max with non-number throws", () => {
      expect(() => parseArgs(["task", "--max", "abc", "--until", "done"])).toThrow(
        '--max requires a positive integer, got "abc"',
      );
    });

    test("--repeat with float throws", () => {
      expect(() => parseArgs(["task", "--repeat", "2.5"])).toThrow(
        '--repeat requires a positive integer, got "2.5"',
      );
    });

    test("--until without value throws", () => {
      expect(() => parseArgs(["task", "--until"])).toThrow("--until requires a condition string");
    });

    test("--repeat without value throws", () => {
      expect(() => parseArgs(["task", "--repeat"])).toThrow("--repeat requires a positive integer");
    });

    test("--max without value throws", () => {
      expect(() => parseArgs(["task", "--max"])).toThrow("--max requires a positive integer");
    });

    test("nested brackets throw", () => {
      expect(() => parseArgs(["[", "a", "[", "b", "]", "]"])).toThrow(
        "Nested brackets are not supported",
      );
    });

    test("unclosed bracket throws", () => {
      expect(() => parseArgs(["[", "a", "b"])).toThrow("Unclosed bracket");
    });

    test("closing bracket without opening throws", () => {
      expect(() => parseArgs(["a", "]"])).toThrow('Unexpected "]" without a matching opening "["');
    });

    test("empty group throws", () => {
      expect(() => parseArgs(["[", "]"])).toThrow("Empty group");
    });

    test("unknown flag throws", () => {
      expect(() => parseArgs(["task", "--verbose"])).toThrow('Unknown flag "--verbose"');
    });

    test("flag inside group throws", () => {
      expect(() => parseArgs(["[", "a", "--until", "done", "]"])).toThrow(
        'Flag "--until" inside a group is not allowed',
      );
    });

    test("--max without --until on a group throws", () => {
      expect(() => parseArgs(["[", "a", "b", "]", "--max", "5"])).toThrow(
        "--max can only be used with --until",
      );
    });
  });
});
