import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "eval/advanced-interpretation-v0.1";
const expectedIds = ["ADV-TIME-01", "ADV-ROUTE-01", "ADV-CLIMB-01", "ADV-HR-01", "ADV-HR-02", "ADV-CAD-01", "ADV-CAD-02", "ADV-POWER-01", "ADV-POWER-02", "ADV-POWER-03", "ADV-BASELINE-01", "ADV-MIXED-01", "ADV-RED-PRIVACY-01", "ADV-RED-SAFETY-01", "ADV-RED-BOUNDARY-01"];
const expectedCounts = { dev: 1, regression: 5, blind: 6, "red-team": 3 };
const forbiddenKeys = new Set(["points", "latitude", "longitude", "fileName", "startTime", "rawTrack", "coordinates"]);

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function hasForbiddenKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) if (forbiddenKeys.has(key) || hasForbiddenKey(child)) return true;
  return false;
}

const manifest = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8")) as { cases: Array<{ caseId: string; split: keyof typeof expectedCounts; file: string; sha256: string }>; counts: typeof expectedCounts; versionMatrix: Record<string, string>; blindAnswerKey: { file: string; sha256: string } };
assert(manifest.cases.length === 15, "CASE_COUNT_MISMATCH");
assert(JSON.stringify(manifest.cases.map((item) => item.caseId).sort()) === JSON.stringify([...expectedIds].sort()), "CASE_ID_MISMATCH");
assert(JSON.stringify(manifest.counts) === JSON.stringify(expectedCounts), "SPLIT_COUNT_MISMATCH");
assert(manifest.versionMatrix.contextSchemaVersion === "0.3" && manifest.versionMatrix.contextRulesVersion === "ride-analysis-context-rules-v0.3", "CONTEXT_VERSION_MISMATCH");

for (const entry of manifest.cases) {
  const raw = await readFile(join(ROOT, entry.file), "utf8");
  const item = JSON.parse(raw) as { caseId: string; split: string; modelInput: { allowedClaims: Array<{ claimId: string; kind: string; key: string; text?: string; value?: number; evidenceIds: string[] }>; limitations: string[]; privacyFlags: string[] }; expected?: unknown; evaluationFocus?: unknown };
  assert(sha256(raw) === entry.sha256, `HASH_MISMATCH:${entry.caseId}`);
  assert(item.caseId === entry.caseId && item.split === entry.split, `IDENTITY_MISMATCH:${entry.caseId}`);
  assert(!hasForbiddenKey(item.modelInput), `PRIVACY_FIELD_PRESENT:${entry.caseId}`);
  assert(item.modelInput.privacyFlags.includes("raw_track_excluded") && item.modelInput.privacyFlags.includes("precise_coordinates_excluded"), `PRIVACY_FLAGS_MISSING:${entry.caseId}`);
  const claimIds = new Set<string>();
  let baseMetricCount = 0;
  let baseFeatureCount = 0;
  for (const claim of item.modelInput.allowedClaims) {
    const isBase = claim.claimId.startsWith(`claim:eval-${entry.caseId.toLowerCase()}:base:`);
    const isAdvanced = claim.claimId.startsWith(`claim:eval-${entry.caseId.toLowerCase()}:advanced:`);
    assert(isBase || isAdvanced, `CLAIM_SCOPE_MISMATCH:${entry.caseId}`);
    if (isBase) {
      assert(claim.kind === "metric" || claim.kind === "feature", `INVALID_BASE_CLAIM:${entry.caseId}`);
      if (claim.kind === "metric") baseMetricCount += 1;
      if (claim.kind === "feature") baseFeatureCount += 1;
    } else {
      assert(claim.kind === "advanced", `NON_ADVANCED_CLAIM:${entry.caseId}`);
    }
    assert(!claimIds.has(claim.claimId) && claim.evidenceIds.length > 0, `CLAIM_CONTRACT_MISMATCH:${entry.caseId}`);
    assert(claim.value === undefined || Number.isFinite(claim.value), `NON_FINITE_VALUE:${entry.caseId}`);
    claimIds.add(claim.claimId);
  }
  assert(baseMetricCount > 0, `BASE_METRIC_MISSING:${entry.caseId}`);
  assert(baseFeatureCount > 0, `BASE_FEATURE_MISSING:${entry.caseId}`);
  const keys = item.modelInput.allowedClaims.map((claim) => claim.key);
  const limitations = item.modelInput.limitations;
  if (limitations.some((item) => item.startsWith("advanced.cadence:"))) assert(!keys.some((key) => key.startsWith("cadence.")), `CADENCE_GATE_FAILED:${entry.caseId}`);
  if (limitations.some((item) => item.startsWith("advanced.power:insufficient") || item.includes("long_gap"))) assert(!keys.some((key) => key.startsWith("power.")), `POWER_GATE_FAILED:${entry.caseId}`);
  if (limitations.includes("advanced.power:ftp_missing")) assert(!keys.some((key) => key === "power.intensityFactor" || key === "power.trainingStressScore" || key.startsWith("power.zone.")), `FTP_GATE_FAILED:${entry.caseId}`);
  if (limitations.includes("advanced.power:weight_missing")) assert(!keys.some((key) => key.includes("Wkg")), `WEIGHT_GATE_FAILED:${entry.caseId}`);
  if (limitations.includes("advanced.heartRate:baseline_system_estimated")) assert(item.modelInput.allowedClaims.some((claim) => claim.key === "heartRate.baseline" && claim.text?.includes("估算")), `HR_BASELINE_GATE_FAILED:${entry.caseId}`);
  assert(entry.split === "blind" || entry.split === "red-team" ? Array.isArray(item.evaluationFocus) : item.expected !== undefined, `SCORING_ISOLATION_FAILED:${entry.caseId}`);
}

const blindKey = await readFile(join(ROOT, manifest.blindAnswerKey.file), "utf8");
assert(sha256(blindKey) === manifest.blindAnswerKey.sha256, "BLIND_KEY_HASH_MISMATCH");
console.log(`Advanced interpretation preflight passed: ${manifest.cases.length} cases, no model calls.`);
