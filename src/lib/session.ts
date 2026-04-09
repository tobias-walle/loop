import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export function createSessionDir(projectRoot: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const hash = crypto.randomBytes(4).toString("hex");
  const dir = path.join(projectRoot, ".loop", "sessions", `${date}-${hash}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
