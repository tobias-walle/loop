import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ConfigError, findProjectConfigPath, getUserConfigPath, loadLoopConfig } from "./index";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "loop-config-test-"));
}

function env(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "", ...values };
}

describe("config loading", () => {
  test("loads defaults when no config exists", () => {
    const root = tmpDir();
    const loaded = loadLoopConfig({
      cwd: root,
      env: env({ LOOP_CONFIG_HOME: path.join(root, "missing") }),
    });
    expect(loaded.config).toEqual({
      agent: "claude",
      agents: {
        claude: { command: "claude", args: { "permission-mode": "auto" }, env: {} },
        pi: { command: "pi", args: {}, env: {} },
      },
    });
  });

  test("resolves user config via LOOP_CONFIG_HOME", () => {
    const root = tmpDir();
    const configHome = path.join(root, "config-home");
    fs.mkdirSync(configHome, { recursive: true });
    fs.writeFileSync(path.join(configHome, "config.toml"), 'agent = "pi"\n');
    const loaded = loadLoopConfig({ cwd: root, env: env({ LOOP_CONFIG_HOME: configHome }) });
    expect(loaded.paths.user).toBe(path.join(configHome, "config.toml"));
    expect(loaded.config.agent).toBe("pi");
  });

  test("resolves user config via XDG_CONFIG_HOME", () => {
    const root = tmpDir();
    const xdg = path.join(root, "xdg");
    fs.mkdirSync(path.join(xdg, "loop"), { recursive: true });
    fs.writeFileSync(path.join(xdg, "loop", "config.toml"), 'agent = "pi"\n');
    const loaded = loadLoopConfig({ cwd: root, env: env({ XDG_CONFIG_HOME: xdg }) });
    expect(loaded.paths.user).toBe(path.join(xdg, "loop", "config.toml"));
    expect(loaded.config.agent).toBe("pi");
  });

  test("falls back to ~/.config/loop/config.toml", () => {
    expect(getUserConfigPath(env())).toBe(
      path.join(os.homedir(), ".config", "loop", "config.toml"),
    );
  });

  test("finds nearest project config walking upward and does not merge multiple", () => {
    const root = tmpDir();
    const child = path.join(root, "a", "b");
    fs.mkdirSync(path.join(root, ".loop"), { recursive: true });
    fs.mkdirSync(path.join(root, "a", ".loop"), { recursive: true });
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(root, ".loop", "config.toml"), 'agent = "claude"\n');
    fs.writeFileSync(path.join(root, "a", ".loop", "config.toml"), 'agent = "pi"\n');

    expect(findProjectConfigPath(child)).toBe(path.join(root, "a", ".loop", "config.toml"));
    const loaded = loadLoopConfig({
      cwd: child,
      env: env({ LOOP_CONFIG_HOME: path.join(root, "none") }),
    });
    expect(loaded.config.agent).toBe("pi");
  });

  test("applies precedence defaults user project env cli", () => {
    const root = tmpDir();
    const configHome = path.join(root, "user");
    fs.mkdirSync(configHome, { recursive: true });
    fs.mkdirSync(path.join(root, ".loop"), { recursive: true });
    fs.writeFileSync(
      path.join(configHome, "config.toml"),
      'agent = "pi"\n[agents.pi]\ncommand = "user-pi"\nenv = { A = "user" }\n[agents.pi.args]\nuser = true\n',
    );
    fs.writeFileSync(
      path.join(root, ".loop", "config.toml"),
      '[agents.pi]\ncommand = "project-pi"\nenv = { A = "project", B = "project" }\n',
    );

    const loaded = loadLoopConfig({
      cwd: root,
      env: env({ LOOP_CONFIG_HOME: configHome, LOOP_AGENT: "pi", LOOP_PI_COMMAND: "env-pi" }),
      cli: { agent: "claude" },
    });
    expect(loaded.config.agent).toBe("claude");
    expect(loaded.config.agents.pi.command).toBe("env-pi");
    expect(loaded.config.agents.pi.args).toEqual({ user: true });
    expect(loaded.config.agents.pi.env).toEqual({ A: "project", B: "project" });
  });

  test("env model overrides work", () => {
    const root = tmpDir();
    const loaded = loadLoopConfig({
      cwd: root,
      env: env({
        LOOP_CONFIG_HOME: path.join(root, "none"),
        LOOP_PI_MODEL: "pi-model",
        LOOP_CLAUDE_MODEL: "claude-model",
      }),
    });
    expect(loaded.config.agents.pi.model).toBe("pi-model");
    expect(loaded.config.agents.claude.model).toBe("claude-model");
  });

  test("unknown keys fail", () => {
    const root = tmpDir();
    const configHome = path.join(root, "user");
    fs.mkdirSync(configHome, { recursive: true });
    fs.writeFileSync(path.join(configHome, "config.toml"), "unknown = true\n");
    expect(() => loadLoopConfig({ cwd: root, env: env({ LOOP_CONFIG_HOME: configHome }) })).toThrow(
      ConfigError,
    );
  });

  test("unknown agents fail", () => {
    const root = tmpDir();
    const configHome = path.join(root, "user");
    fs.mkdirSync(configHome, { recursive: true });
    fs.writeFileSync(path.join(configHome, "config.toml"), '[agents.other]\ncommand = "x"\n');
    expect(() => loadLoopConfig({ cwd: root, env: env({ LOOP_CONFIG_HOME: configHome }) })).toThrow(
      "agents: Unrecognized key",
    );
  });

  test("invalid TOML fails with path", () => {
    const root = tmpDir();
    const configHome = path.join(root, "user");
    const file = path.join(configHome, "config.toml");
    fs.mkdirSync(configHome, { recursive: true });
    fs.writeFileSync(file, "=");
    expect(() => loadLoopConfig({ cwd: root, env: env({ LOOP_CONFIG_HOME: configHome }) })).toThrow(
      file,
    );
  });

  test("rejects old array arg syntax", () => {
    const root = tmpDir();
    const configHome = path.join(root, "user");
    fs.mkdirSync(configHome, { recursive: true });
    fs.writeFileSync(path.join(configHome, "config.toml"), '[agents.pi]\nargs = ["--user"]\n');
    expect(() => loadLoopConfig({ cwd: root, env: env({ LOOP_CONFIG_HOME: configHome }) })).toThrow(
      "agents.pi.args",
    );
  });

  test("structured args merge with defaults", () => {
    const root = tmpDir();
    const configHome = path.join(root, "user");
    fs.mkdirSync(configHome, { recursive: true });
    fs.writeFileSync(
      path.join(configHome, "config.toml"),
      '[agents.claude.args]\npermission-mode = "bypassPermissions"\nsome-flag = true\ndisabled = false\n',
    );
    const loaded = loadLoopConfig({ cwd: root, env: env({ LOOP_CONFIG_HOME: configHome }) });
    expect(loaded.config.agents.claude.args).toEqual({
      "permission-mode": "bypassPermissions",
      "some-flag": true,
      disabled: false,
    });
  });

  test("zod errors include field paths", () => {
    const root = tmpDir();
    const configHome = path.join(root, "user");
    fs.mkdirSync(configHome, { recursive: true });
    fs.writeFileSync(path.join(configHome, "config.toml"), '[agents.pi]\nargs = "bad"\n');
    expect(() => loadLoopConfig({ cwd: root, env: env({ LOOP_CONFIG_HOME: configHome }) })).toThrow(
      "agents.pi.args",
    );
  });
});
