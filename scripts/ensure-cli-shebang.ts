import * as fs from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("Usage: ensure-cli-shebang <file>");

const shebang = "#!/usr/bin/env node\n";
const contents = fs.readFileSync(file, "utf-8");
const withoutShebang = contents.startsWith("#!")
  ? contents.slice(contents.indexOf("\n") + 1)
  : contents;
fs.writeFileSync(file, `${shebang}${withoutShebang}`, { mode: 0o755 });
fs.chmodSync(file, 0o755);
