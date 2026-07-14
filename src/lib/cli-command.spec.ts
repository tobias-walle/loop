import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { CliError, createCliCommand, formatHelp, parseCliArgs } from "./cli-command";

describe("parseCliArgs", () => {
  test("builds the CLI with Commander", () => {
    expect(createCliCommand()).toBeInstanceOf(Command);
  });

  describe("single task", () => {
    test("parses a single task string", () => {
      const result = parseCliArgs(["Create an about page"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Create an about page" }],
      });
    });
  });

  describe("sequential tasks", () => {
    test("parses multiple tasks in sequence", () => {
      const result = parseCliArgs(["task1", "task2", "task3"]);
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
      expect(parseCliArgs(["resume"])).toEqual({ steps: [], command: "resume" });
    });

    test.each([
      ["resume", "another task"],
      ["resume", "--", "--profile", "fast"],
    ])("rejects excess arguments with Commander: %p", (...args) => {
      expect(() => parseCliArgs(args)).toThrow("too many arguments for 'resume'");
    });

    test("rejects global options for resume", () => {
      expect(() => parseCliArgs(["--agent", "pi", "resume"])).toThrow(
        "resume accepts no other arguments",
      );
    });
  });

  describe("init subcommands", () => {
    test("defaults init to user scope", () => {
      expect(parseCliArgs(["init"])).toEqual({
        steps: [],
        command: "init",
        initScope: "user",
      });
    });

    test("parses project init with a template", () => {
      expect(parseCliArgs(["init", "--project", "--include-template"])).toEqual({
        steps: [],
        command: "init",
        initScope: "project",
        includeTemplate: true,
      });
    });

    test("defaults init-recipe to user scope", () => {
      expect(parseCliArgs(["init-recipe", "implement"])).toEqual({
        steps: [],
        command: "init-recipe",
        initRecipeName: "implement",
        initScope: "user",
      });
    });

    test("parses init-recipe scope before or after its name", () => {
      expect(parseCliArgs(["init-recipe", "--project", "implement"])).toMatchObject({
        initRecipeName: "implement",
        initScope: "project",
      });
      expect(parseCliArgs(["init-recipe", "implement", "--project"])).toMatchObject({
        initRecipeName: "implement",
        initScope: "project",
      });
    });

    test("rejects conflicting init scopes", () => {
      expect(() => parseCliArgs(["init", "--user", "--project"])).toThrow(
        "--user and --project cannot be combined",
      );
      expect(() => parseCliArgs(["init-recipe", "implement", "--project", "--user"])).toThrow(
        "--user and --project cannot be combined",
      );
    });

    test("rejects user templates", () => {
      expect(() => parseCliArgs(["init", "--include-template"])).toThrow(
        "--include-template requires --project",
      );
    });

    test("uses Commander to require exactly one recipe name", () => {
      expect(() => parseCliArgs(["init-recipe"])).toThrow("missing required argument 'name'");
      expect(() => parseCliArgs(["init-recipe", "one", "two"])).toThrow(
        "too many arguments for 'init-recipe'",
      );
    });
  });

  describe("help", () => {
    test("--help returns root help", () => {
      const result = parseCliArgs(["--help"]);
      expect(result).toMatchObject({ steps: [], command: "help" });
      expect(result.helpText).toContain("Usage: loop");
    });

    test("-h returns root help", () => {
      const result = parseCliArgs(["-h"]);
      expect(result).toMatchObject({ steps: [], command: "help" });
      expect(result.helpText).toContain("Usage: loop");
    });

    test("--help anywhere in args returns help", () => {
      const result = parseCliArgs(["task", "--help"]);
      expect(result).toMatchObject({ steps: [], command: "help" });
      expect(result.helpText).toContain("Usage: loop");
    });

    test("shows context-specific help for init-recipe", () => {
      const result = parseCliArgs(["init-recipe", "--help"]);
      expect(result).toMatchObject({ steps: [], command: "help" });
      expect(result.helpText).toContain("Usage: loop init-recipe [options] <name>");
      expect(result.helpText).toContain("--project");
      expect(result.helpText).not.toContain("--recipe <name>");
    });
  });

  describe("version", () => {
    test("--version returns version command", () => {
      const result = parseCliArgs(["--version"]);
      expect(result).toEqual({ steps: [], command: "version" });
    });

    test("-v returns version command", () => {
      const result = parseCliArgs(["-v"]);
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

    test("includes Commander options section", () => {
      const help = formatHelp();
      expect(help).toContain("Options:");
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
      const result = parseCliArgs(["[", "Review code", "Fix issues", "]"]);
      expect(result).toEqual({
        steps: [{ type: "group", tasks: ["Review code", "Fix issues"] }],
      });
    });

    test("parses a group with a single task", () => {
      const result = parseCliArgs(["[", "Review code", "]"]);
      expect(result).toEqual({
        steps: [{ type: "group", tasks: ["Review code"] }],
      });
    });

    test("parses task before a group", () => {
      const result = parseCliArgs(["Create page", "[", "Review", "Fix", "]"]);
      expect(result).toEqual({
        steps: [
          { type: "task", task: "Create page" },
          { type: "group", tasks: ["Review", "Fix"] },
        ],
      });
    });

    test("parses task after a group", () => {
      const result = parseCliArgs(["[", "Review", "Fix", "]", "Deploy"]);
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
      const result = parseCliArgs(["Work on tasks", "--until", "All done"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Work on tasks", until: "All done" }],
      });
    });

    test("--repeat on a task", () => {
      const result = parseCliArgs(["Run tests", "--repeat", "3"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Run tests", repeat: 3 }],
      });
    });

    test("--until + --max on a task", () => {
      const result = parseCliArgs(["Fix bugs", "--until", "No bugs left", "--max", "10"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Fix bugs", until: "No bugs left", max: 10 }],
      });
    });

    test("--arg on a task", () => {
      const result = parseCliArgs([
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
      const result = parseCliArgs(["Fix bugs", "--max", "5", "--until", "Clean"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Fix bugs", until: "Clean", max: 5 }],
      });
    });
  });

  describe("flags on groups", () => {
    test("--repeat on a group", () => {
      const result = parseCliArgs(["[", "Review", "Fix", "]", "--repeat", "3"]);
      expect(result).toEqual({
        steps: [{ type: "group", tasks: ["Review", "Fix"], repeat: 3 }],
      });
    });

    test("--until on a group", () => {
      const result = parseCliArgs(["[", "Review", "Fix", "]", "--until", "No issues"]);
      expect(result).toEqual({
        steps: [{ type: "group", tasks: ["Review", "Fix"], until: "No issues" }],
      });
    });

    test("--until + --max on a group", () => {
      const result = parseCliArgs(["[", "Review", "Fix", "]", "--until", "Clean", "--max", "10"]);
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
      const result = parseCliArgs(["[", "Review", "Fix", "]", "--arg", "permission-mode=auto"]);
      expect(result).toEqual({
        steps: [{ type: "group", tasks: ["Review", "Fix"], args: { "permission-mode": "auto" } }],
      });
    });
  });

  describe("mixed sequences", () => {
    test("sequential task + grouped task with flags", () => {
      const result = parseCliArgs([
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
      const result = parseCliArgs(["Fix bugs", "--until", "Clean", "Deploy"]);
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
      const result = parseCliArgs(["--agent", "pi", "Fix tests"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Fix tests" }],
        agent: "pi",
      });
    });

    test("captures trailing passthrough args", () => {
      const result = parseCliArgs(["Fix tests", "--", "--profile", "fast"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Fix tests" }],
        passthroughArgs: ["--profile", "fast"],
      });
    });

    test("captures passthrough after task flags", () => {
      const result = parseCliArgs(["Fix tests", "--repeat", "2", "--", "--profile", "fast"]);
      expect(result).toEqual({
        steps: [{ type: "task", task: "Fix tests", repeat: 2 }],
        passthroughArgs: ["--profile", "fast"],
      });
    });

    test("rejects -- before tasks", () => {
      expect(() => parseCliArgs(["--", "--profile", "fast"])).toThrow("No arguments provided");
    });

    test("rejects unknown agent", () => {
      expect(() => parseCliArgs(["--agent", "other", "task"])).toThrow(
        "Allowed choices are claude, pi",
      );
    });
  });

  describe("recipes", () => {
    test("parses --recipe with named recipe args", () => {
      const result = parseCliArgs(["--recipe", "implement", "--plan", "./PLAN.md"]);
      expect(result).toEqual({
        steps: [],
        recipe: { name: "implement", args: ["--plan", "./PLAN.md"] },
      });
    });

    test("parses -r with positional recipe args", () => {
      const result = parseCliArgs(["-r", "implement", "./PLAN.md"]);
      expect(result).toEqual({
        steps: [],
        recipe: { name: "implement", args: ["./PLAN.md"] },
      });
    });

    test("parses global agent and passthrough with recipe", () => {
      const result = parseCliArgs([
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

    test("allows a recipe named like a command", () => {
      expect(parseCliArgs(["--recipe", "resume"])).toEqual({
        steps: [],
        recipe: { name: "resume", args: [] },
      });
    });

    test("rejects recipe without name", () => {
      expect(() => parseCliArgs(["--recipe"])).toThrow("argument missing");
      expect(() => parseCliArgs(["-r"])).toThrow("argument missing");
    });
  });

  describe("validation errors", () => {
    test("empty args throws", () => {
      expect(() => parseCliArgs([])).toThrow(CliError);
      expect(() => parseCliArgs([])).toThrow("No arguments provided");
    });

    test("--max without --until throws", () => {
      expect(() => parseCliArgs(["task", "--max", "5"])).toThrow(CliError);
      expect(() => parseCliArgs(["task", "--max", "5"])).toThrow(
        "--max can only be used with --until",
      );
    });

    test("--repeat + --until throws", () => {
      expect(() => parseCliArgs(["task", "--repeat", "3", "--until", "done"])).toThrow(CliError);
      expect(() => parseCliArgs(["task", "--repeat", "3", "--until", "done"])).toThrow(
        "--repeat and --until cannot be combined",
      );
    });

    test("--repeat + --max throws", () => {
      expect(() => parseCliArgs(["task", "--repeat", "3", "--max", "5"])).toThrow(CliError);
      expect(() => parseCliArgs(["task", "--repeat", "3", "--max", "5"])).toThrow(
        "--repeat and --max cannot be combined",
      );
    });

    test("flag at start with no preceding task throws", () => {
      expect(() => parseCliArgs(["--until", "done"])).toThrow(CliError);
      expect(() => parseCliArgs(["--until", "done"])).toThrow(
        'Flag "--until" has no preceding task or group',
      );
    });

    test("--repeat 0 throws", () => {
      expect(() => parseCliArgs(["task", "--repeat", "0"])).toThrow(CliError);
      expect(() => parseCliArgs(["task", "--repeat", "0"])).toThrow(
        "--repeat requires a positive integer",
      );
    });

    test("--max 0 throws", () => {
      expect(() => parseCliArgs(["task", "--max", "0", "--until", "done"])).toThrow(CliError);
      expect(() => parseCliArgs(["task", "--max", "0", "--until", "done"])).toThrow(
        "--max requires a positive integer",
      );
    });

    test("--repeat with negative number throws", () => {
      expect(() => parseCliArgs(["task", "--repeat", "-1"])).toThrow(
        "--repeat requires a positive integer",
      );
    });

    test("--repeat with non-number throws", () => {
      expect(() => parseCliArgs(["task", "--repeat", "abc"])).toThrow(
        '--repeat requires a positive integer, got "abc"',
      );
    });

    test("--max with non-number throws", () => {
      expect(() => parseCliArgs(["task", "--max", "abc", "--until", "done"])).toThrow(
        '--max requires a positive integer, got "abc"',
      );
    });

    test("--repeat with float throws", () => {
      expect(() => parseCliArgs(["task", "--repeat", "2.5"])).toThrow(
        '--repeat requires a positive integer, got "2.5"',
      );
    });

    test("--until without value throws", () => {
      expect(() => parseCliArgs(["task", "--until"])).toThrow("argument missing");
    });

    test("--repeat without value throws", () => {
      expect(() => parseCliArgs(["task", "--repeat"])).toThrow("argument missing");
    });

    test("--max without value throws", () => {
      expect(() => parseCliArgs(["task", "--max"])).toThrow("argument missing");
    });

    test("--arg without value throws", () => {
      expect(() => parseCliArgs(["task", "--arg"])).toThrow("argument missing");
    });

    test("--arg rejects leading dashes", () => {
      expect(() => parseCliArgs(["task", "--arg", "--permission-mode=auto"])).toThrow(
        "without leading dashes",
      );
    });

    test("--arg rejects empty values", () => {
      expect(() => parseCliArgs(["task", "--arg", "permission-mode="])).toThrow("cannot be empty");
    });

    test("nested brackets throw", () => {
      expect(() => parseCliArgs(["[", "a", "[", "b", "]", "]"])).toThrow(
        "Nested brackets are not supported",
      );
    });

    test("unclosed bracket throws", () => {
      expect(() => parseCliArgs(["[", "a", "b"])).toThrow("Unclosed bracket");
    });

    test("closing bracket without opening throws", () => {
      expect(() => parseCliArgs(["a", "]"])).toThrow(
        'Unexpected "]" without a matching opening "["',
      );
    });

    test("empty group throws", () => {
      expect(() => parseCliArgs(["[", "]"])).toThrow("Empty group");
    });

    test("unknown flag throws", () => {
      expect(() => parseCliArgs(["task", "--verbose"])).toThrow('Unknown flag "--verbose"');
    });

    test("flag inside group throws", () => {
      expect(() => parseCliArgs(["[", "a", "--until", "done", "]"])).toThrow(
        'Flag "--until" inside a group is not allowed',
      );
    });

    test("--max without --until on a group throws", () => {
      expect(() => parseCliArgs(["[", "a", "b", "]", "--max", "5"])).toThrow(
        "--max can only be used with --until",
      );
    });
  });
});
