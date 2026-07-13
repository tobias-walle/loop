import * as fs from "node:fs";
import * as path from "node:path";
import { formatHelp } from "../lib/parser.js";
import type { LoopConfig } from "../lib/types.js";
import { runInitCommand } from "./init-command.js";

export function handlePreTuiCommand(config: LoopConfig, write: (message: string) => void): boolean {
  if (config.command === "help") {
    write(formatHelp());
    return true;
  }
  if (config.command === "version") {
    const pkgPath = path.resolve(import.meta.dirname ?? ".", "../../package.json");
    write((JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version: string }).version);
    return true;
  }
  return runInitCommand(config, write);
}
