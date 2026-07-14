import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse } from "smol-toml";
import { cyan, dim, green, yellow } from "../lib/ansi.js";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const temporaryDirs: string[] = [];

function temporaryDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-init-test-"));
  temporaryDirs.push(dir);
  return dir;
}

async function runCli(args: string[], cwd: string, configHome: string) {
  const child = Bun.spawn([process.execPath, path.join(REPO_ROOT, "src/cli.ts"), ...args], {
    cwd,
    env: { ...process.env, LOOP_CONFIG_HOME: configHome },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("loop init", () => {
  test("creates a user config and example recipe by default", async () => {
    const root = temporaryDir();
    const project = path.join(root, "project");
    const configHome = path.join(root, "config");
    fs.mkdirSync(project);

    const result = await runCli(["init"], project, configHome);

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain(
      `${green("✓ Created")} ${cyan(path.join(configHome, "config.toml"))}`,
    );
    expect(result.stdout).toContain(
      `${green("✓ Created")} ${cyan(path.join(configHome, "recipes", "example.yaml"))}`,
    );
    const config = fs.readFileSync(path.join(configHome, "config.toml"), "utf-8");
    expect(config.split("\n").filter((line) => line.trim() && !line.startsWith("#"))).toEqual([]);
    const uncommentedDefaults = config
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("# ") && !line.startsWith("# Loop") && !line.startsWith("# Uncomment"),
      )
      .map((line) => line.slice(2))
      .join("\n");
    expect(parse(uncommentedDefaults)).toEqual({
      agent: "claude",
      agents: {
        claude: { command: "claude", args: { "permission-mode": "auto" }, env: {} },
        pi: { command: "pi", args: {}, env: {} },
      },
    });
    expect(fs.readFileSync(path.join(configHome, "recipes", "example.yaml"), "utf-8")).toContain(
      "description: example recipe",
    );
    expect(fs.existsSync(path.join(project, ".loop", "LOOP.md"))).toBe(false);
  });

  test("creates project files and an optional template", async () => {
    const root = temporaryDir();
    const project = path.join(root, "project");
    const configHome = path.join(root, "config");
    fs.mkdirSync(project);

    const scaffoldResult = await runCli(["init", "--project"], project, configHome);

    expect(scaffoldResult).toMatchObject({ exitCode: 0, stderr: "" });
    expect(scaffoldResult.stdout).toContain(
      `${green("✓ Created")} ${cyan(path.join(".loop", "config.toml"))}`,
    );
    expect(fs.existsSync(path.join(project, ".loop", "config.toml"))).toBe(true);
    expect(fs.existsSync(path.join(project, ".loop", "recipes", "example.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(project, ".loop", "LOOP.md"))).toBe(false);
    expect(fs.existsSync(configHome)).toBe(false);

    const templateResult = await runCli(
      ["init", "--project", "--include-template"],
      project,
      configHome,
    );
    expect(templateResult).toMatchObject({ exitCode: 0, stderr: "" });
    expect(fs.existsSync(path.join(project, ".loop", "LOOP.md"))).toBe(true);
  });

  test("does not overwrite existing scaffold files", async () => {
    const root = temporaryDir();
    const project = path.join(root, "project");
    const configHome = path.join(root, "config");
    const recipes = path.join(configHome, "recipes");
    fs.mkdirSync(recipes, { recursive: true });
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(configHome, "config.toml"), "custom config");
    fs.writeFileSync(path.join(recipes, "example.yaml"), "custom recipe");

    const result = await runCli(["init"], project, configHome);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `${yellow("○ Skipped")} ${dim(`${path.join(configHome, "config.toml")} (already exists)`)}`,
    );
    expect(result.stdout).toContain(
      `${yellow("○ Skipped")} ${dim(`${path.join(configHome, "recipes", "example.yaml")} (already exists)`)}`,
    );
    expect(fs.readFileSync(path.join(configHome, "config.toml"), "utf-8")).toBe("custom config");
    expect(fs.readFileSync(path.join(recipes, "example.yaml"), "utf-8")).toBe("custom recipe");
  });
});

describe("loop init-recipe", () => {
  test("creates user recipes by default and project recipes when requested", async () => {
    const root = temporaryDir();
    const project = path.join(root, "project");
    const configHome = path.join(root, "config");
    fs.mkdirSync(project);

    const userResult = await runCli(["init-recipe", "personal"], project, configHome);
    const projectResult = await runCli(["init-recipe", "shared", "--project"], project, configHome);

    expect(userResult.exitCode).toBe(0);
    expect(projectResult.exitCode).toBe(0);
    expect(fs.existsSync(path.join(configHome, "recipes", "personal.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(project, ".loop", "recipes", "shared.yaml"))).toBe(true);
  });
});
