/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    { name: "no-unresolved", severity: "error", from: {}, to: { couldNotResolve: true } },
    {
      name: "production-does-not-use-dev-dependencies",
      severity: "error",
      from: { path: "^src/", pathNot: "(?:\\.spec\\.ts$|^src/testing/)" },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "lib-is-independent",
      severity: "error",
      from: { path: "^src/lib/", pathNot: "\\.spec\\.ts$" },
      to: { path: "^src/(?:commands|output|tui|testing)/" },
    },
    {
      name: "lib-uses-only-agent-contracts",
      severity: "error",
      from: { path: "^src/lib/", pathNot: "\\.spec\\.ts$" },
      to: { path: "^src/agents/", pathNot: "^src/agents/types\\.ts$" },
    },
    {
      name: "agents-are-headless",
      severity: "error",
      from: { path: "^src/agents/", pathNot: "\\.spec\\.ts$" },
      to: { path: "^src/(?:commands|output|tui|testing)/" },
    },
    {
      name: "output-is-headless",
      severity: "error",
      from: { path: "^src/output/", pathNot: "\\.spec\\.ts$" },
      to: { path: "^src/(?:commands|tui|testing)/" },
    },
    {
      name: "output-uses-only-agent-contracts",
      severity: "error",
      from: { path: "^src/output/", pathNot: "\\.spec\\.ts$" },
      to: { path: "^src/agents/", pathNot: "^src/agents/types\\.ts$" },
    },
    {
      name: "tui-is-not-application-or-output",
      severity: "error",
      from: { path: "^src/tui/", pathNot: "\\.spec\\.ts$" },
      to: { path: "^src/(?:commands|output|testing)/" },
    },
    {
      name: "tui-uses-only-agent-contracts",
      severity: "error",
      from: { path: "^src/tui/", pathNot: "\\.spec\\.ts$" },
      to: { path: "^src/agents/", pathNot: "^src/agents/types\\.ts$" },
    },
    {
      name: "cli-stays-a-composition-root",
      severity: "error",
      from: { path: "^src/cli\\.ts$" },
      to: { path: "^src/(?:agents|output|tui|testing)/" },
    },
    {
      name: "production-does-not-import-testing",
      severity: "error",
      from: { path: "^src/", pathNot: "(?:\\.spec\\.ts$|^src/testing/)" },
      to: { path: "^src/testing/" },
    },
    {
      name: "pi-tui-stays-in-tui",
      severity: "error",
      from: { path: "^src/", pathNot: "(?:^src/tui/|\\.spec\\.ts$|^src/testing/)" },
      to: { path: "^@mariozechner/pi-tui" },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    moduleSystems: ["es6", "cjs"],
    doNotFollow: { path: "node_modules" },
  },
};
