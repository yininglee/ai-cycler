import { performance } from "node:perf_hooks";

import { generateB0RideAnalysis, validateB0RideAnalysis } from "../src/domain/ride-summary.ts";
import { rideFixtures } from "../src/fixtures/rides.ts";

const runs = rideFixtures.map((fixture) => {
  const startedAt = performance.now();
  const result = generateB0RideAnalysis(fixture.activity);
  const latencyMs = performance.now() - startedAt;
  const validation = validateB0RideAnalysis(result);
  return { fixtureId: fixture.fixtureId, latencyMs, validation };
});

const sortedLatencies = runs.map((run) => run.latencyMs).sort((a, b) => a - b);
const percentile = (ratio: number): number => {
  const index = Math.max(0, Math.ceil(sortedLatencies.length * ratio) - 1);
  return sortedLatencies[index] ?? 0;
};
const failed = runs.filter((run) => !run.validation.valid);

console.log(JSON.stringify({
  benchmark: "B0",
  templateVersion: "b0-template-v0.1",
  fixtureSet: "RideActivity v0.2 / RideSeries v0.1 fixtures",
  caseCount: runs.length,
  validContractCount: runs.length - failed.length,
  failedCount: failed.length,
  numericAndClaimGrounding: failed.length === 0 ? `${runs.length}/${runs.length}` : "failed",
  capabilityBoundaryPass: failed.length === 0 ? `${runs.length}/${runs.length}` : "failed",
  modelCalls: 0,
  tokenCount: 0,
  costCny: 0,
  latencyMs: {
    p50: Number(percentile(0.5).toFixed(3)),
    p95: Number(percentile(0.95).toFixed(3)),
  },
  failures: failed.map((run) => ({ fixtureId: run.fixtureId, issues: run.validation.issues })),
}, null, 2));

if (failed.length > 0) process.exitCode = 1;
