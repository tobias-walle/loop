import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  RecipeError,
  createDefaultRecipeTemplate,
  getUserRecipePath,
  loadRecipe,
  readRecipeFile,
  renderRecipeTemplate,
  resolveRecipeArguments,
} from "./index";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "loop-recipe-test-"));
}

function testEnv(root: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "", LOOP_CONFIG_HOME: path.join(root, "missing-config") };
}

function writeProjectRecipe(root: string, name: string, content: string): string {
  const dir = path.join(root, ".loop", "recipes");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.yaml`);
  fs.writeFileSync(file, content);
  return file;
}

describe("recipes", () => {
  test("loads a YAML recipe and renders all step features", () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "my-plan.md"), "plan");
    const recipePath = writeProjectRecipe(
      root,
      "implement",
      `description: Implement a plan

arguments:
  - name: plan
    type: file
    description: Plan file

steps:
  - task: Use the implement skill with the next phase in $PLAN. Commit and stop after every phase
    until: All phases are done and only manual verification remains
    args:
      permission-mode: auto

  - tasks:
      - Review the changes in {{plan}}
      - Correct the findings
    repeat: 2
`,
    );

    const loaded = loadRecipe("implement", ["--plan", "./my-plan.md"], {
      cwd: root,
      env: testEnv(root),
    });

    expect(loaded.path).toBe(recipePath);
    expect(loaded.values).toEqual({ plan: "./my-plan.md" });
    expect(loaded.steps).toEqual([
      {
        type: "task",
        task: "Use the implement skill with the next phase in ./my-plan.md. Commit and stop after every phase",
        until: "All phases are done and only manual verification remains",
        args: { "permission-mode": "auto" },
      },
      {
        type: "group",
        tasks: ["Review the changes in ./my-plan.md", "Correct the findings"],
        repeat: 2,
      },
    ]);
  });

  test("maps positional args to recipe arguments", () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "PLAN.md"), "plan");
    writeProjectRecipe(
      root,
      "implement",
      `arguments:
  - name: plan
    type: file

steps:
  - task: Implement {{plan}}
`,
    );

    const loaded = loadRecipe("implement", ["./PLAN.md"], { cwd: root, env: testEnv(root) });
    expect(loaded.steps).toEqual([{ type: "task", task: "Implement ./PLAN.md" }]);
  });

  test("falls back to user recipes", () => {
    const root = tmpDir();
    const configHome = path.join(root, "config-home");
    const recipePath = getUserRecipePath("review", { LOOP_CONFIG_HOME: configHome });
    fs.mkdirSync(path.dirname(recipePath), { recursive: true });
    fs.writeFileSync(recipePath, "steps:\n  - task: Review\n");

    const loaded = loadRecipe("review", [], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", LOOP_CONFIG_HOME: configHome },
    });

    expect(loaded.path).toBe(recipePath);
    expect(loaded.steps).toEqual([{ type: "task", task: "Review" }]);
  });

  test("does not load TOML recipes", () => {
    const root = tmpDir();
    const dir = path.join(root, ".loop", "recipes");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "review.toml"), '[[steps]]\ntask = "Review"\n');

    expect(() => loadRecipe("review", [], { cwd: root, env: testEnv(root) })).toThrow(
      ".loop/recipes/review.yaml",
    );
  });

  test("validates argument values", () => {
    const root = tmpDir();
    const recipe = readRecipeFile(
      writeProjectRecipe(
        root,
        "args",
        `arguments:
  - name: mode
    choices: [fast, safe]
  - name: count
    type: integer
    default: 2
  - name: dry_run
    type: boolean
    required: false

steps:
  - task: Run $MODE $COUNT $DRY_RUN
`,
      ),
    );

    expect(resolveRecipeArguments(recipe, ["--mode", "fast", "--dry-run"], { cwd: root })).toEqual({
      mode: "fast",
      count: 2,
      dry_run: true,
    });
    expect(() => resolveRecipeArguments(recipe, ["--mode", "slow"], { cwd: root })).toThrow(
      'Recipe argument "mode" must be one of',
    );
    expect(() =>
      resolveRecipeArguments(recipe, ["--mode", "fast", "--count", "x"], { cwd: root }),
    ).toThrow('Recipe argument "count" must be an integer');
  });

  test("renders string agent args", () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "PLAN.md"), "plan");
    writeProjectRecipe(
      root,
      "review",
      `arguments:
  - name: plan
    type: file

steps:
  - task: Review $PLAN
    args:
      permission-mode: "$PLAN"
      verbose: true
`,
    );

    const loaded = loadRecipe("review", ["./PLAN.md"], { cwd: root, env: testEnv(root) });
    expect(loaded.steps).toEqual([
      {
        type: "task",
        task: "Review ./PLAN.md",
        args: { "permission-mode": "./PLAN.md", verbose: true },
      },
    ]);
  });

  test("keeps unknown placeholders unchanged", () => {
    expect(renderRecipeTemplate("$PLAN $HOME {{plan}} {{missing}}", { plan: "PLAN.md" })).toBe(
      "PLAN.md $HOME PLAN.md {{missing}}",
    );
  });

  test("reports schema errors with paths", () => {
    const root = tmpDir();
    const file = writeProjectRecipe(
      root,
      "bad",
      `arguments:
  - name: plan
  - name: plan

steps:
  - task: x
    repeat: 2
    until: done
`,
    );

    expect(() => readRecipeFile(file)).toThrow(RecipeError);
    expect(() => readRecipeFile(file)).toThrow("arguments.1.name");
    expect(() => readRecipeFile(file)).toThrow("steps.0.repeat");
  });

  test("reports missing and unknown arguments", () => {
    const root = tmpDir();
    writeProjectRecipe(
      root,
      "implement",
      `arguments:
  - name: plan

steps:
  - task: Implement {{plan}}
`,
    );

    expect(() => loadRecipe("implement", [], { cwd: root, env: testEnv(root) })).toThrow(
      'Missing required recipe argument "plan"',
    );
    expect(() =>
      loadRecipe("implement", ["--unknown", "x"], { cwd: root, env: testEnv(root) }),
    ).toThrow('Unknown recipe argument "--unknown"');
  });

  test("default recipe template is valid YAML", () => {
    const root = tmpDir();
    const file = writeProjectRecipe(root, "starter", createDefaultRecipeTemplate("starter"));
    expect(readRecipeFile(file).steps).toHaveLength(2);
  });
});
