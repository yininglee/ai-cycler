/**
 * 诊断 R02 真实上传 A 的 NUMBER_NOT_IN_CLAIMS("8") 根因。
 * dump representativeClimbCount / terrain.climbRunCount 的 value/displayValue，
 * 以及 climbPerformance 维度实际投递的 claimIds。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { loadDemoImportedRides } from "../src/fixtures/demo-imported-rides.ts";
import { buildRideElevationSummary } from "../src/domain/ride-elevation.ts";
import { buildRideRouteShapeSummary } from "../src/domain/ride-route-shape.ts";
import { buildRideEventClimbSummary } from "../src/domain/ride-event-climbs.ts";
import { buildRideTemporalWindowsV2 } from "../src/domain/ride-temporal-windows-v2.ts";
import { buildRideProfileHistoryV2 } from "../src/domain/ride-profile-history-v2.ts";
import { buildRideAnalysisEvidencePacketsV2 } from "../src/domain/ride-analysis-evidence-packets-v2.ts";
import { attachRideKnowledgeEvidenceV2 } from "../src/domain/ride-analysis-knowledge-v2.ts";
import { rideKnowledgeBaseV21, RIDE_KNOWLEDGE_BASE_V21_VERSION } from "../src/domain/ride-knowledge-base-v21.ts";
import { buildRideModelInputV2 } from "../src/domain/ride-model-input-v2.ts";

const RIDE_ID = "upload-0312e501-02d6-4a02-bba1-c05d4e35cff5";

interface StoredProfile { age?: { value?: number }; maxHeartRate?: { valueBpm?: number }; heightCm?: { value?: number }; weightKg?: { value?: number }; ftp?: { valueWatts?: number }; }

async function main() {
  const state = JSON.parse(await readFile(join(process.cwd(), ".local-data", "application-state.json"), "utf8"));
  const entry = (state.rides as Record<string, { record?: unknown }> | undefined)?.[RIDE_ID];
  if (!entry?.record) throw new Error(`uploaded ride not found: ${RIDE_ID}`);
  const stored = state.profiles?.[Object.keys(state.profiles ?? {})[0]];
  const profile = createUserProfile({
    age: stored.age?.value ?? 30,
    heightCm: stored.heightCm?.value ?? 172,
    weightKg: stored.weightKg?.value ?? 70,
    maxHeartRateBpm: stored.maxHeartRate?.valueBpm ?? 190,
    ftpWatts: stored.ftp?.valueWatts ?? 200,
  });
  const record = entry.record;

  const elevationSummary = buildRideElevationSummary(record as never);
  const routeShape = buildRideRouteShapeSummary(elevationSummary);
  const eventClimbs = buildRideEventClimbSummary(elevationSummary, routeShape, record as never);
  const windows = buildRideTemporalWindowsV2(record as never, { climbs: eventClimbs, routeShape });
  console.log("climbRepresentativeCounts:", JSON.stringify(windows.climbRepresentativeCounts));
  console.log("terrain.segmentCounts:", JSON.stringify((windows as unknown as { terrain?: { segmentCounts?: unknown } }).terrain?.segmentCounts));

  const profileHistory = buildRideProfileHistoryV2(record as never, { profile, windows });
  const packets = buildRideAnalysisEvidencePacketsV2(profileHistory.capabilityClaims, {
    analysisRunId: "diag-r02",
    userScope: "diag",
  });
  const knowledgeContext = attachRideKnowledgeEvidenceV2(packets, {
    knowledgeBase: rideKnowledgeBaseV21,
    knowledgeBaseVersion: RIDE_KNOWLEDGE_BASE_V21_VERSION,
    retrievedAt: new Date().toISOString(),
  });
  const result = buildRideModelInputV2(knowledgeContext, { analysisRunId: "diag-r02", userScope: "diag" });
  if (result.status !== "ready") throw new Error(`input blocked: ${result.failureCode}`);
  const input = result.input;

  const wanted = new Set([
    "climb.representativeClimbCount",
    "terrain.climbRunCount",
    "metric.elevationGainM",
    "metric.elevationLossM",
    "terrain.trendClimbDistanceM",
  ]);
  console.log("\n=== 相关 claim 的实际值 ===");
  for (const c of input.claims) {
    if (wanted.has(c.key)) {
      console.log(`${c.key}: value=${c.value} (${c.unit}) displayValue=${c.displayValue ?? "-"} text=${c.text ?? "-"}`);
    }
  }
  console.log("\n=== climbPerformance 维度投递的 claimIds ===");
  const climbQ = input.questions.find((q) => q.dimensionId === "climbPerformance");
  if (climbQ) {
    for (const id of climbQ.claimIds) {
      const c = input.claims.find((x) => x.claimId === id);
      console.log(`  ${id}${c ? ` -> key=${c.key} value=${c.value}` : " (缺失)"}`);
    }
  }
}

await main();
