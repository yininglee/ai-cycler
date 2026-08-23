import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

interface MigrationCase {
  sourceCaseId: string;
  targetCaseId: string;
  status: "READY" | "NEEDS_FIXTURE";
  expectedDimensionKeys: string[];
}

interface MigrationManifest {
  schemaVersion: string;
  targetOutputSchema: string;
  targetSurface: string;
  fewShotMode: string;
  cases: MigrationCase[];
  deferredSourceCases: Array<{ sourceCaseIds: string[]; targetFile: string }>;
}

function manifest(): MigrationManifest {
  return JSON.parse(readFileSync(new URL("../eval/ride-analysis-cases-v0.3-migration.json", import.meta.url), "utf8")) as MigrationManifest;
}

test("T001 migration manifest stays aligned with the v0.3 automatic ride contract", () => {
  const value = manifest();
  assert.equal(value.schemaVersion, "ride-analysis-eval-migration-v0.1");
  assert.equal(value.targetOutputSchema, "ride-analysis-output-v0.3");
  assert.equal(value.targetSurface, "automatic_ride_analysis");
  assert.equal(value.fewShotMode, "disabled");
  assert.equal(value.cases.length, 18);

  const targetIds = value.cases.map((item) => item.targetCaseId);
  assert.equal(new Set(targetIds).size, 18);
  assert.ok(targetIds.every((id) => /^RA-AUTO-\d{3}$/.test(id)));
  assert.equal(value.cases.filter((item) => item.status === "READY").length, 18);
  assert.equal(value.cases.filter((item) => item.status === "NEEDS_FIXTURE").length, 0);
  assert.ok(value.cases.every((item) => typeof (item as MigrationCase & { fixture?: string }).fixture === "string"));
  assert.ok(value.cases.every((item) => item.expectedDimensionKeys.every((key) => ["endurance", "pace", "climbing", "heartRate", "power", "cadence", "history"].includes(key))));
});

test("T001 migration keeps dialogue-only source cases out of automatic ride analysis", () => {
  const value = manifest();
  const deferred = value.deferredSourceCases.flatMap((group) => group.sourceCaseIds);
  assert.equal(deferred.length, 12);
  assert.ok(value.deferredSourceCases.every((group) => group.targetFile === "eval/ride-chat-cases-v0.1.jsonl"));
  assert.ok(deferred.every((id) => /^(SAFE|SEC|TOOL|RAG)-\d{3}$/.test(id)));

  const chatCases = readFileSync(new URL("../eval/ride-chat-cases-v0.1.jsonl", import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { case_id: string; contract_version: string; status: string });
  assert.equal(chatCases.length, 12);
  assert.equal(new Set(chatCases.map((item) => item.case_id)).size, 12);
  assert.ok(chatCases.every((item) => item.contract_version === "ride-chat-eval-v0.1" && item.status === "DEFERRED_FROM_AUTO_RIDE"));
});
