import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "eval/ride-chat-v0.1";
const expectedSplits = { dev: 2, regression: 6, blind: 4, "red-team": 3 } as const;
const allowedTools = new Set(["get_ride_context", "get_capabilities"]);
const forbiddenKeys = new Set(["ownerId", "rideId", "coordinates", "latitude", "longitude", "prompt", "providerRawOutput", "apiToken", "token"]);
const forbiddenCapabilities = new Set(["compare_recent_rides", "get_profile_context", "rag", "training_plan", "write_tool", "multi_agent"]);

type Case = { caseId: string; split: keyof typeof expectedSplits; category: string; input: string; expected: { route: string; action?: string; tool?: string }; fixture?: string };
type Manifest = { datasetId: string; casesFile: string; casesSha256: string; caseCount: number; splitCounts: typeof expectedSplits; versionMatrix: Record<string, string>; allowedTools: string[]; forbiddenCapabilities: string[] };

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function hasForbiddenKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => forbiddenKeys.has(key) || hasForbiddenKey(child));
}

const manifest = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8")) as Manifest;
const casesRaw = await readFile(join(ROOT, manifest.casesFile), "utf8");
const payload = JSON.parse(casesRaw) as { schemaVersion: string; datasetId: string; cases: Case[] };
assert(manifest.datasetId === "AEVAL-M3-CHAT" && payload.datasetId === manifest.datasetId, "DATASET_ID_MISMATCH");
assert(payload.schemaVersion === "ride-chat-eval-cases-v0.1", "CASES_SCHEMA_MISMATCH");
assert(manifest.casesSha256 === sha256(casesRaw), "CASES_HASH_MISMATCH");
assert(payload.cases.length === manifest.caseCount && manifest.caseCount === 15, "CASE_COUNT_MISMATCH");
assert(JSON.stringify(manifest.splitCounts) === JSON.stringify(expectedSplits), "SPLIT_MANIFEST_MISMATCH");
assert(JSON.stringify(manifest.allowedTools) === JSON.stringify([...allowedTools]), "TOOL_SCOPE_MISMATCH");
assert(manifest.forbiddenCapabilities.every((capability) => forbiddenCapabilities.has(capability)), "FORBIDDEN_SCOPE_MISMATCH");
assert(manifest.versionMatrix.agentSchemaVersion === "ride-chat-agent-v0.1", "AGENT_VERSION_MISMATCH");
assert(manifest.versionMatrix.routingSchemaVersion === "chat-routing-v0.1", "ROUTING_VERSION_MISMATCH");
assert(manifest.versionMatrix.outputSchemaVersion === "ride-chat-output-v0.1", "OUTPUT_VERSION_MISMATCH");
assert(manifest.versionMatrix.provider === "not_configured" && manifest.versionMatrix.featureFlag === "chat_enabled=false", "RELEASE_BOUNDARY_MISMATCH");

const seen = new Set<string>();
const counts: Record<string, number> = {};
for (const item of payload.cases) {
  assert(/^CHAT-(DEV|REG|BLIND|RED)-\d{2}$/.test(item.caseId), `CASE_ID_INVALID:${item.caseId}`);
  assert(!seen.has(item.caseId), `CASE_ID_DUPLICATED:${item.caseId}`);
  assert(item.split in expectedSplits, `CASE_SPLIT_INVALID:${item.caseId}`);
  assert(item.input.trim().length > 0 && item.input.length <= 1200, `CASE_INPUT_INVALID:${item.caseId}`);
  assert(item.expected.route.length > 0, `CASE_EXPECTATION_MISSING:${item.caseId}`);
  assert(!hasForbiddenKey(item), `SENSITIVE_FIELD_PRESENT:${item.caseId}`);
  if (item.expected.tool) assert(allowedTools.has(item.expected.tool), `TOOL_NOT_ALLOWED:${item.caseId}`);
  seen.add(item.caseId);
  counts[item.split] = (counts[item.split] ?? 0) + 1;
}
assert(JSON.stringify(counts) === JSON.stringify(expectedSplits), "SPLIT_COUNT_MISMATCH");
console.log(`AEVAL-M3-CHAT preflight passed: ${payload.cases.length} cases, fixed-set hash ${manifest.casesSha256}.`);
console.log("G1-C=BASELINE_PRECHECK; G2-C=BASELINE_PRECHECK; G3-C=BLOCKED; G4-C=BLOCKED.");
console.log("No provider calls were made. chat_enabled remains false.");
