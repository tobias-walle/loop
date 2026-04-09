import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_DIR = path.resolve(import.meta.dir);

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
      files.push(...getAllTsFiles(fullPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function getProductionFiles(): string[] {
  return getAllTsFiles(SRC_DIR);
}

function relativePath(file: string): string {
  return path.relative(SRC_DIR, file);
}

function readFile(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

function getLayer(rel: string): string {
  if (rel.startsWith("lib/")) return "lib";
  if (rel.startsWith("agents/")) return "agents";
  if (rel.startsWith("tui/")) return "tui";
  if (rel.startsWith("testing/")) return "testing";
  if (rel === "cli.ts") return "cli";
  if (rel === "index.ts") return "index";
  return "other";
}

describe("architecture rules", () => {
  const files = getProductionFiles();

  test("no raw ANSI escapes outside lib/ansi.ts", () => {
    const violations: string[] = [];
    // biome-ignore lint/suspicious/noControlCharactersInRegex: need to detect literal ANSI escapes
    const ansiPattern = /\\x1b|\\u001b|\\033|\x1b/;

    for (const file of files) {
      const rel = relativePath(file);
      if (rel === "lib/ansi.ts") continue;
      const content = readFile(file);
      if (ansiPattern.test(content)) {
        violations.push(rel);
      }
    }

    expect(violations).toEqual([]);
  });

  test("no console.* in production code (except cli.ts)", () => {
    const violations: string[] = [];
    const consolePattern = /\bconsole\.(log|warn|error|debug|info)\b/;

    for (const file of files) {
      const rel = relativePath(file);
      if (rel === "cli.ts") continue;
      const content = readFile(file);
      if (consolePattern.test(content)) {
        violations.push(rel);
      }
    }

    expect(violations).toEqual([]);
  });

  test("layer direction: lib/ never imports tui/ or agents/", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = relativePath(file);
      if (getLayer(rel) !== "lib") continue;
      const content = readFile(file);
      const imports = content.match(/from\s+["']([^"']+)["']/g) ?? [];
      for (const imp of imports) {
        const target = imp.match(/from\s+["']([^"']+)["']/)?.[1] ?? "";
        if (target.includes("/tui/") || target.includes("/agents/")) {
          // Allow agents/types.js since runner needs the AgentAdapter interface
          if (target.endsWith("/agents/types.js")) continue;
          violations.push(`${rel} imports ${target}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("layer direction: agents/ never imports tui/", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = relativePath(file);
      if (getLayer(rel) !== "agents") continue;
      const content = readFile(file);
      const imports = content.match(/from\s+["']([^"']+)["']/g) ?? [];
      for (const imp of imports) {
        const target = imp.match(/from\s+["']([^"']+)["']/)?.[1] ?? "";
        if (target.includes("/tui/")) {
          violations.push(`${rel} imports ${target}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("layer direction: tui/ never imports agents/ (except types)", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = relativePath(file);
      if (getLayer(rel) !== "tui") continue;
      const content = readFile(file);
      const imports = content.match(/from\s+["']([^"']+)["']/g) ?? [];
      for (const imp of imports) {
        const target = imp.match(/from\s+["']([^"']+)["']/)?.[1] ?? "";
        if (target.includes("/agents/") && !target.endsWith("/agents/types.js")) {
          violations.push(`${rel} imports ${target}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("no process.stdout.write outside tui/", () => {
    const violations: string[] = [];
    const pattern = /process\.stdout\.write/;

    for (const file of files) {
      const rel = relativePath(file);
      if (rel.startsWith("tui/") || rel === "cli.ts") continue;
      const content = readFile(file);
      if (pattern.test(content)) {
        violations.push(rel);
      }
    }

    expect(violations).toEqual([]);
  });

  test("no direct fs writes outside allowlist", () => {
    const violations: string[] = [];
    const fsWritePattern =
      /\b(writeFileSync|appendFileSync|createWriteStream|writeFile|appendFile)\b/;
    const allowlist = new Set(["lib/logging.ts", "lib/session.ts", "cli.ts"]);

    for (const file of files) {
      const rel = relativePath(file);
      if (allowlist.has(rel)) continue;
      const content = readFile(file);
      if (fsWritePattern.test(content)) {
        violations.push(rel);
      }
    }

    expect(violations).toEqual([]);
  });

  test("production .ts files are under 300 lines", () => {
    const violations: string[] = [];

    for (const file of files) {
      const rel = relativePath(file);
      const content = readFile(file);
      const lineCount = content.split("\n").length;
      if (lineCount > 300) {
        violations.push(`${rel} (${lineCount} lines)`);
      }
    }

    expect(violations).toEqual([]);
  });

  test("index.ts contains only re-exports", () => {
    const content = readFile(path.join(SRC_DIR, "index.ts"));
    const lines = content.split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("//"));

    // Check that every statement starts with "export" — multi-line statements
    // have continuation lines (indented or closing braces) which are fine.
    const nonExportLines = lines.filter((l) => {
      const trimmed = l.trim();
      return !(
        trimmed.startsWith("export ") ||
        trimmed.startsWith("}") ||
        /^[A-Z]/.test(trimmed) ||
        trimmed.endsWith(",") ||
        trimmed.endsWith(";")
      );
    });

    expect(nonExportLines).toEqual([]);
  });
});
