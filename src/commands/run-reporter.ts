import { createConsoleRunReporter } from "../output/console-run-reporter.js";
import type { RunOutput, RunReporter } from "../output/run-reporter.js";
import { createLiveRunReporter } from "../tui/live-run-reporter.js";

interface RunReporterFactories {
  createLive(output: RunOutput): RunReporter;
  createConsole(output: RunOutput): RunReporter;
}

const defaultFactories: RunReporterFactories = {
  createLive: createLiveRunReporter,
  createConsole: createConsoleRunReporter,
};

export function createRunReporter(
  output: RunOutput,
  factories: RunReporterFactories = defaultFactories,
): RunReporter {
  return output.isTTY ? factories.createLive(output) : factories.createConsole(output);
}
