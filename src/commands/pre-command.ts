import * as fs from "node:fs";
import * as path from "node:path";
import { formatHelp } from "../lib/cli-command.js";
import type { LoopConfig } from "../lib/types.js";
import { runInitCommand } from "./init-command.js";

export function handlePreTuiCommand(config: LoopConfig, write: (message: string) => void): boolean {
  if (config.command === "help") {
    write(config.helpText ?? formatHelp());
    return true;
  }
  if (config.command === "version") {
    const moduleDir = import.meta.dirname ?? ".";
    const pkgPath = ["../package.json", "../../package.json"]
      .map((candidate) => path.resolve(moduleDir, candidate))
      .find((candidate) => fs.existsSync(candidate));
    if (!pkgPath) throw new Error("Could not locate package.json.");
    write((JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version: string }).version);
    return true;
  }
  return runInitCommand(config, write);
}
