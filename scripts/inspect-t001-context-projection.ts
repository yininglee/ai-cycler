import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

import {
  projectRideAnalysisContextForModel,
  RIDE_ANALYSIS_MODEL_CONTEXT_PROJECTION_VERSION,
} from "../src/ai/ride-analysis-context-projection.ts";
import type { RideAnalysisContext } from "../src/domain/ride-analysis-context.ts";

const inputDir = new URL("../output/coze-inputs/", import.meta.url);
const outputUrl = new URL("../eval/runs/T001-original-prompt-projection-preflight-v0.1.json", import.meta.url);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const cases = readdirSync(inputDir)
  .filter((file) => /^t001-RA-AUTO-\d{3}\.json$/.test(file))
  .sort()
  .map((file) => {
    const input = JSON.parse(readFileSync(new URL(file, inputDir), "utf8")) as { analysis_context: string };
    const context = JSON.parse(input.analysis_context) as RideAnalysisContext;
    const projected = JSON.stringify(projectRideAnalysisContextForModel(context));
    return {
      caseId: file.slice("t001-".length, -".json".length),
      originalBytes: Buffer.byteLength(input.analysis_context, "utf8"),
      projectedBytes: Buffer.byteLength(projected, "utf8"),
      reductionBytes: Buffer.byteLength(input.analysis_context, "utf8") - Buffer.byteLength(projected, "utf8"),
      originalSha256: sha256(input.analysis_context),
      projectedSha256: sha256(projected),
      allowedClaimCount: context.allowedClaims.length,
      projectedKeys: Object.keys(JSON.parse(projected)),
    };
  });

const originalBytes = cases.reduce((sum, item) => sum + item.originalBytes, 0);
const projectedBytes = cases.reduce((sum, item) => sum + item.projectedBytes, 0);
const report = {
  schemaVersion: "t001-original-prompt-projection-preflight-v0.1",
  projectionVersion: RIDE_ANALYSIS_MODEL_CONTEXT_PROJECTION_VERSION,
  externalCalls: 0,
  promptVersion: "3.1.2",
  workflow: { name: "ride_analysis_v2", id: "7676429753852018707", version: "v0.0.2" },
  timeoutMs: 15_000,
  caseCount: cases.length,
  originalBytes,
  projectedBytes,
  reductionBytes: originalBytes - projectedBytes,
  reductionRate: originalBytes === 0 ? 0 : Number(((originalBytes - projectedBytes) / originalBytes).toFixed(4)),
  cases,
};
writeFileSync(outputUrl, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
