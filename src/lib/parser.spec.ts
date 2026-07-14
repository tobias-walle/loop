import { describe, expect, test } from "bun:test";
import { ParseError, formatHelp, parseArgs } from "./parser";

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

  describe("resume command", () => {
    test("parses exact resume command", () => {
      expect(parseArgs(["resume"])).toEqual({ steps: [], command: "resume" });
    });

    test.each([
      ["resume", "another task"],
      ["--agent", "pi", "resume"],
      ["resume", "--", "--profile", "fast"],
      ["--recipe", "resume"],
    ])("rejects incompatible arguments: %p", (...args) => {
      expect(() => parseArgs(args)).toThrow("resume accepts no other arguments");
    });
  });

  describe("init subcommands", () => {
    test("defaults init to user scope", () => {
      expect(parseArgs(["init"])).toEqual({
        steps: [],
        command: "init",
        initScope: "user",
      });
    });

    test("parses project init with a template", () => {
      expect(parseArgs(["init", "--project", "--include-template"])).toEqual({
        steps: [],
        command: "init",
        initScope: "project",
        includeTemplate: true,
      });
    });

    test("defaults init-recipe to user scope", () => {
      expect(parseArgs(["init-recipe", "implement"])).toEqual({
        steps: [],
        command: "init-recipe",
        initRecipeName: "implement",
        initScope: "user",
      });
    });

    test("parses init-recipe scope before or after its name", () => {
      expect(parseArgs(["init-recipe", "--project", "implement"])).toMatchObject({
        initRecipeName: "implement",
        initScope: "project",
      });
      expect(parseArgs(["init-recipe", "implement", "--project"])).toMatchObject({
        initRecipeName: "implement",
        initScope: "project",
      });
    });

    test("rejects conflicting init scopes", () => {
      expect(() => parseArgs(["init", "--user", "--project"])).toThrow(
        "--user and --project cannot be combined",
      );
      expect(() => parseArgs(["init-recipe", "implement", "--project", "--user"])).toThrow(
        "--user and --project cannot be combined",
      );
    });

    test("rejects user templates", () => {
      expect(() => parseArgs(["init", "--include-template"])).toThrow(
        "--include-template requires --project",
      );
    });

    test("rejects init-recipe without exactly one name", () => {
      expect(() => parseArgs(["init-recipe"])).toThrow("init-recipe requires a name");
      expect(() => parseArgs(["init-recipe", "one", "two"])).toThrow(
        "init-recipe accepts exactly one name",
      );
    });
  });

  describe("help", () => {
    test("--help returns help command", () => {
      const result = parseArgs(["--help"]);
      expect(result).toEqual({ steps: [], command: "help" });
    });

    test("-h returns help command", () => {
      const result = parseArgs(["-h"]);
      expect(result).toEqual({ steps: [], command: "help" });
    });

    test("--help anywhere in args returns help", () => {
      const result = parseArgs(["task", "--help"]);
      expect(result).toEqual({ steps: [], command: "help" });
    });
  });

  describe("version", () => {
    test("--version returns version command", () => {
      const result = parseArgs(["--version"]);
      expect(result).toEqual({ steps: [], command: "version" });
    });

    test("-v returns version command", () => {
      const result = parseArgs(["-v"]);
      expect(result).toEqual({ steps: [], command: "version" });
    });
  });

  describe("formatHelp", () => {
    test("includes usage line", () => {
      expect(formatHelp()).toContain("Usage:");
    });

    test("includes commands section", () => {
      const help = formatHelp();
      expect(help).toContain("Commands:");
      expect(help).toContain("init");
      expect(help).toContain("init-recipe");
      expect(help).toContain("resume");
    });

    test("includes flags section", () => {
      const help = formatHelp();
      expect(help).toContain("Flags:");
      expect(help).toContain("--until");
      expect(help).toContain("--repeat");
      expect(help).toContain("--max");
      expect(help).toContain("--arg");
    });

    test("includes examples section", () => {
      expect(formatHelp()).toContain("Examples:");
    });

    test("includes groups section", () => {
      expect(formatHelp()).toContain("Groups:");
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

    test("--arg on a task", () => {
      const result = parseArgs([
        "Review",
        "--arg",
        "permission-mode=auto",
        "Fix",
        "--arg",
        "permission-mode=bypassPermissions",
        "--arg",
        "dangerously-skip-permissions",
      ]);
      expect(result).toEqual({
        steps: [
          { type: "task", task: "Review", args: { "permission-mode": "auto" } },
          {
            type: "task",
            task: "Fix",
            args: { "permission-mode": "bypassPermissions", "dangerously-skip-permissions": true },
          },
        ],
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

    test("--arg on a group", () => {
      const result = parseArgs(["[", "Review", "Fix", "]", "--arg", "permission-mode=auto"]);
      expect(result).toEqual({
        steps: [{ type: "group", tasks: ["Review", "Fix"], args: { "permission-mode": "auto" } }],
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

  describe("agent options", () => {
    test("parses --agent before tasks", () => {
      const result = parseArgs(["--agent", "pi", "Fix tests"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Fix tests" }],
        agent: "pi",
      });
    });

    test("captures trailing passthrough args", () => {
      const result = parseArgs(["Fix tests", "--", "--profile", "fast"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Fix tests" }],
        passthroughArgs: ["--profile", "fast"],
      });
    });

    test("captures passthrough after task flags", () => {
      const result = parseArgs(["Fix tests", "--repeat", "2", "--", "--profile", "fast"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Fix tests", repeat: 2 }],
        passthroughArgs: ["--profile", "fast"],
      });
    });

    test("rejects -- before tasks", () => {
      expect(() => parseArgs(["--", "--profile", "fast"])).toThrow("No arguments provided");
    });

    test("rejects unknown agent", () => {
      expect(() => parseArgs(["--agent", "other", "task"])).toThrow(
        '--agent must be "claude" or "pi"',
      );
    });
  });

  describe("recipes", () => {
    test("parses --recipe with named recipe args", () => {
      const result = parseArgs(["--recipe", "implement", "--plan", "./PLAN.md"]);
      expect(result).toEqual({
        steps: [],
        recipe: { name: "implement", args: ["--plan", "./PLAN.md"] },
      });
    });

    test("parses -r with positional recipe args", () => {
      const result = parseArgs(["-r", "implement", "./PLAN.md"]);
      expect(result).toEqual({
        steps: [],
        recipe: { name: "implement", args: ["./PLAN.md"] },
      });
    });

    test("parses global agent and passthrough with recipe", () => {
      const result = parseArgs([
        "--agent",
        "pi",
        "-r",
        "implement",
        "./PLAN.md",
        "--",
        "--profile",
        "fast",
      ]);
      expect(result).toEqual({
        steps: [],
        agent: "pi",
        recipe: { name: "implement", args: ["./PLAN.md"] },
        passthroughArgs: ["--profile", "fast"],
      });
    });

    test("rejects recipe without name", () => {
      expect(() => parseArgs(["--recipe"])).toThrow("--recipe requires a recipe name");
      expect(() => parseArgs(["-r"])).toThrow("-r requires a recipe name");
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

    test("--arg without value throws", () => {
      expect(() => parseArgs(["task", "--arg"])).toThrow("--arg requires a flag");
    });

    test("--arg rejects leading dashes", () => {
      expect(() => parseArgs(["task", "--arg", "--permission-mode=auto"])).toThrow(
        "without leading dashes",
      );
    });

    test("--arg rejects empty values", () => {
      expect(() => parseArgs(["task", "--arg", "permission-mode="])).toThrow("cannot be empty");
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
