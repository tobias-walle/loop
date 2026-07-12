import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { getUserConfigDir, getUserStateDir } from "./storage-paths";

const home = path.join(path.sep, "home", "test");

describe("storage paths", () => {
  test("uses explicit Loop homes first", () => {
    expect(getUserConfigDir({ LOOP_CONFIG_HOME: "/config" }, "linux", home)).toBe(
      path.resolve("/config"),
    );
    expect(getUserStateDir({ LOOP_STATE_HOME: "/state" }, "linux", home)).toBe(
      path.resolve("/state"),
    );
  });

  test("supports XDG config and state homes", () => {
    const env = { XDG_CONFIG_HOME: "/xdg/config", XDG_STATE_HOME: "/xdg/state" };
    expect(getUserConfigDir(env, "linux", home)).toBe(path.join("/xdg/config", "loop"));
    expect(getUserStateDir(env, "linux", home)).toBe(path.join("/xdg/state", "loop"));
  });

  test("uses Linux defaults", () => {
    expect(getUserConfigDir({}, "linux", home)).toBe(path.join(home, ".config", "loop"));
    expect(getUserStateDir({}, "linux", home)).toBe(path.join(home, ".local", "state", "loop"));
  });

  test("uses macOS defaults", () => {
    const base = path.join(home, "Library", "Application Support", "loop");
    expect(getUserConfigDir({}, "darwin", home)).toBe(path.join(base, "config"));
    expect(getUserStateDir({}, "darwin", home)).toBe(path.join(base, "state"));
  });

  test("uses roaming config and local state on Windows", () => {
    const env = { APPDATA: "C:\\Roaming", LOCALAPPDATA: "C:\\Local" };
    expect(getUserConfigDir(env, "win32", home)).toBe(path.join(env.APPDATA, "loop"));
    expect(getUserStateDir(env, "win32", home)).toBe(path.join(env.LOCALAPPDATA, "loop"));
  });
});
