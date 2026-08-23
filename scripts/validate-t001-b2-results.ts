import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  evaluateT001B2Batch,
  parseT001B2RawBatch,
} from "../src/eval/t001-b2-benchmark.ts";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/validate-t001-b2-results.ts <raw-batch.json>");
  process.exit(2);
}

const raw = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
const batch = parseT001B2RawBatch(raw);
const result = await evaluateT001B2Batch(batch);
if (result.validationStatus !== "PASS") {
  console.error(JSON.stringify({ validationStatus: result.validationStatus, benchmarkStatus: result.benchmarkStatus, issues: result.issues }, null, 2));
  process.exit(1);
}

await mkdir("eval/runs", { recursive: true });
const artifact = `eval/runs/${result.runId}.json`;
await writeFile(artifact, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({
  validationStatus: result.validationStatus,
  benchmarkStatus: result.benchmarkStatus,
  runId: result.runId,
  summary: result.summary,
  artifact,
}, null, 2));
