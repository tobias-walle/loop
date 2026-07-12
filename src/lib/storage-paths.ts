import * as os from "node:os";
import * as path from "node:path";

export type SupportedPlatform = "darwin" | "linux" | "win32";

const APP_DIR_NAME = "loop";
const CONFIG_FILE_NAME = "config.toml";
const RECIPES_DIR_NAME = "recipes";
const SESSIONS_DIR_NAME = "sessions";
const SESSION_METADATA_NAME = "session.json";
const SESSION_EVENTS_NAME = "events.jsonl";

export const PROJECT_DIR_NAME = ".loop";
export const PROJECT_TEMPLATE_NAME = "LOOP.md";
export const RECIPE_EXTENSION = ".yaml";

export function getProjectDir(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), PROJECT_DIR_NAME);
}

export function getProjectTemplatePath(projectRoot: string): string {
  return path.join(getProjectDir(projectRoot), PROJECT_TEMPLATE_NAME);
}

export function getProjectConfigPath(projectRoot: string): string {
  return path.join(getProjectDir(projectRoot), CONFIG_FILE_NAME);
}

export function getProjectRecipesDir(projectRoot: string): string {
  return path.join(getProjectDir(projectRoot), RECIPES_DIR_NAME);
}

export function getProjectRecipePath(name: string, projectRoot: string): string {
  return path.join(getProjectRecipesDir(projectRoot), `${name}${RECIPE_EXTENSION}`);
}

function platformOrLinux(platform: NodeJS.Platform): SupportedPlatform {
  if (platform === "darwin" || platform === "win32") return platform;
  return "linux";
}

export function getUserConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  if (env.LOOP_CONFIG_HOME) return path.resolve(env.LOOP_CONFIG_HOME);
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, APP_DIR_NAME);

  switch (platformOrLinux(platform)) {
    case "darwin":
      return path.join(home, "Library", "Application Support", APP_DIR_NAME, "config");
    case "win32":
      return path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), APP_DIR_NAME);
    case "linux":
      return path.join(home, ".config", APP_DIR_NAME);
  }
}

export function getUserConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getUserConfigDir(env), CONFIG_FILE_NAME);
}

export function getUserRecipesDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getUserConfigDir(env), RECIPES_DIR_NAME);
}

export function getUserRecipePath(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getUserRecipesDir(env), `${name}${RECIPE_EXTENSION}`);
}

export function getUserStateDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  if (env.LOOP_STATE_HOME) return path.resolve(env.LOOP_STATE_HOME);
  if (env.XDG_STATE_HOME) return path.join(env.XDG_STATE_HOME, APP_DIR_NAME);

  switch (platformOrLinux(platform)) {
    case "darwin":
      return path.join(home, "Library", "Application Support", APP_DIR_NAME, "state");
    case "win32":
      return path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), APP_DIR_NAME);
    case "linux":
      return path.join(home, ".local", "state", APP_DIR_NAME);
  }
}

export function getSessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getUserStateDir(env), SESSIONS_DIR_NAME);
}

export function getSessionMetadataPath(sessionDir: string): string {
  return path.join(sessionDir, SESSION_METADATA_NAME);
}

export function getSessionEventsPath(sessionDir: string): string {
  return path.join(sessionDir, SESSION_EVENTS_NAME);
}
