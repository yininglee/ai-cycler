import { readFile, writeFile } from "node:fs/promises";

import {
  comparePromptAb,
} from "../src/eval/t001-prompt-ab.ts";
import {
  parseT001B2RawBatch,
  evaluateT001B2Batch,
  type T001B2EvaluatedBatch,
} from "../src/eval/t001-b2-benchmark.ts";

const aPath = process.argv.find((arg) => arg.startsWith("--a="))?.slice("--a=".length);
const bPath = process.argv.find((arg) => arg.startsWith("--b="))?.slice("--b=".length);
const outPath = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length)
  ?? "eval/runs/T001-PROMPT-AB-comparison-v0.1.json";

if (!aPath || !bPath) {
  console.error("Usage: node scripts/compare-t001-prompt-ab.ts --a=eval/runs/A.json --b=eval/runs/B.json [--out=...]");
  process.exit(2);
}

async function loadEvaluated(path: string, arm: "A" | "B"): Promise<T001B2EvaluatedBatch> {
  const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const result = value.schemaVersion === "t001-b2-evaluated-run-v0.3"
    ? value as unknown as T001B2EvaluatedBatch
    : await evaluateT001B2Batch(parseT001B2RawBatch(value));
  if (result.experiment) return result;
  return {
    ...result,
    experiment: {
      experimentId: "T001-PROMPT-AB-v0.1",
      arm,
      promptAsset: arm === "A"
        ? "prompts/cycling-buddy-ride-analysis-v3.1.2.md"
        : "prompts/cycling-buddy-ride-analysis-v3.1.2-compact-candidate.md",
      platformWorkflowVersion: arm === "A" ? "v0.0.2" : "UNKNOWN",
      ...(arm === "A" ? { baselineRunId: "RUN-20260825-756" } : {}),
      timeoutMs: 15_000,
      sameModel: true,
      sameInputSet: true,
    },
  };
}

const comparison = comparePromptAb(await loadEvaluated(aPath, "A"), await loadEvaluated(bPath, "B"));
await writeFile(outPath, `${JSON.stringify(comparison, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ artifact: outPath, status: comparison.status, arms: comparison.arms, delta: comparison.delta }, null, 2));
