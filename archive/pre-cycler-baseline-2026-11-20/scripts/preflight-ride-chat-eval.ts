import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "eval/ride-chat-v0.1";
// CHAT-13（固定集 v0.3）：+3 历史比较案例（可比成功/不可比降级/跨用户锚点），compare_rides 入工具白名单。
// CHAT-14（固定集 v0.4）：+2 锚点案例（"本次"锚点澄清 TOOLS_ANCHOR_CLARIFY / 显式日期直查），原依赖"本次"锚点的用例改写为"最近一次"。
// CHAT-17（固定集 v0.6，27→34）：+7 L2b 自主工具循环案例——find_ride 极值检索成功、复合问题
// 成功、无匹配零模型降级、预算耗尽降级、白名单外工具组合拒绝、越权锚点拒绝、Demo 无模型降级。
const expectedSplits = { dev: 2, regression: 25, blind: 4, "red-team": 3 } as const;
const allowedTools = new Set(["get_ride_context", "get_capabilities", "compare_rides", "find_ride"]);
// CHAT-17 P6：L2b 循环结局枚举（loopTrace.status）与失败注入 fixture 白名单（Runner 同步维护）。
const loopStatuses = new Set(["completed", "budget_exhausted", "no_match", "invalid_tool_call", "failed"]);
const knownFixtures = new Set([
  "no-current-ride", "tool-timeout", "empty-claims", "no-comparable-history", "anchor-clarify",
  "provider-not-configured", "invalid-then-valid-provider", "hmac-events-and-account-deletion",
  "loop-budget-exhaustion-provider", "loop-forbidden-tool-provider", "loop-unauthorized-ride-provider",
]);
const forbiddenKeys = new Set(["ownerId", "rideId", "coordinates", "latitude", "longitude", "prompt", "providerRawOutput", "apiToken", "token"]);
const forbiddenCapabilities = new Set(["compare_recent_rides", "get_profile_context", "rag", "training_plan", "write_tool", "multi_agent"]);

type Case = { caseId: string; split: keyof typeof expectedSplits; category: string; input: string; expected: { route: string; action?: string; tool?: string; fallbackCode?: string; provider?: string; loopStatus?: string }; fixture?: string };
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
assert(payload.cases.length === manifest.caseCount && manifest.caseCount === 34, "CASE_COUNT_MISMATCH");
assert(JSON.stringify(manifest.splitCounts) === JSON.stringify(expectedSplits), "SPLIT_MANIFEST_MISMATCH");
assert(JSON.stringify(manifest.allowedTools) === JSON.stringify([...allowedTools]), "TOOL_SCOPE_MISMATCH");
assert(manifest.forbiddenCapabilities.every((capability) => forbiddenCapabilities.has(capability)), "FORBIDDEN_SCOPE_MISMATCH");
assert(manifest.versionMatrix.agentSchemaVersion === "ride-chat-agent-v0.1", "AGENT_VERSION_MISMATCH");
assert(manifest.versionMatrix.routingSchemaVersion === "chat-routing-v0.1", "ROUTING_VERSION_MISMATCH");
assert(manifest.versionMatrix.outputSchemaVersion === "ride-chat-output-v0.1", "OUTPUT_VERSION_MISMATCH");
// M3 收口（2026-09-10）：用户决策 Demo 范围先行放行 chat_enabled；provider 保持 not_configured（固定集不绑定 Provider）。
assert(manifest.versionMatrix.provider === "not_configured" && manifest.versionMatrix.featureFlag === "chat_enabled=true(demo_scope)", "RELEASE_BOUNDARY_MISMATCH");

const seen = new Set<string>();
const counts: Record<string, number> = {};
for (const item of payload.cases) {
  assert(/^CHAT-(DEV|REG|BLIND|RED)-\d{2}$/.test(item.caseId), `CASE_ID_INVALID:${item.caseId}`);
  assert(!seen.has(item.caseId), `CASE_ID_DUPLICATED:${item.caseId}`);
  assert(item.split in expectedSplits, `CASE_SPLIT_INVALID:${item.caseId}`);
  assert(item.input.trim().length > 0 && item.input.length <= 1200, `CASE_INPUT_INVALID:${item.caseId}`);
  assert(item.expected.route.length > 0, `CASE_EXPECTATION_MISSING:${item.caseId}`);
  assert(!hasForbiddenKey(item), `SENSITIVE_FIELD_PRESENT:${item.caseId}`);
  if (item.fixture) assert(knownFixtures.has(item.fixture), `CASE_FIXTURE_UNKNOWN:${item.caseId}`);
  if (item.expected.tool) assert(allowedTools.has(item.expected.tool), `TOOL_NOT_ALLOWED:${item.caseId}`);
  // CHAT-17 P6：L2b 期望合同——TOOLS_LOOP_* 降级必须同时冻结 loopStatus；loopStatus 取值限枚举。
  if (item.expected.loopStatus) assert(loopStatuses.has(item.expected.loopStatus), `LOOP_STATUS_INVALID:${item.caseId}`);
  if (item.expected.fallbackCode?.startsWith("TOOLS_LOOP_")) assert(item.expected.loopStatus !== undefined, `LOOP_STATUS_MISSING:${item.caseId}`);
  seen.add(item.caseId);
  counts[item.split] = (counts[item.split] ?? 0) + 1;
}
assert(JSON.stringify(counts) === JSON.stringify(expectedSplits), "SPLIT_COUNT_MISMATCH");
console.log(`AEVAL-M3-CHAT preflight passed (fixed set v0.6): ${payload.cases.length} cases, hash ${manifest.casesSha256}.`);
console.log("CHAT-17 L2b scenarios frozen: find_ride extreme/composite success, no-match, budget-exhausted, forbidden-tool, unauthorized-anchor, demo no-provider.");
console.log("No provider calls were made. M3 closure gates (27-case v0.5 Run AEVAL-M3-CHAT-20260910-002) remain valid; v0.6 real-model Run pending Prompt v0.1.6 + classifier v0.3 and user authorization.");
