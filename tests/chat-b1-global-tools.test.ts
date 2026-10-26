// AGT-B1：三个全局工具（health_profile / training_load / search_knowledge_base）的执行投影单测。
//
// 归口细规划 §7 AGT-B1 退出条件：每工具合法/非法输入、缺失数据、`unavailable` 各原因、
// KB 三态（命中/部分覆盖/未命中）。TSS 计算是 B1 新增链路（review 发现 ride-pmc-load-v2
// 从未接线），因此单独覆盖纯函数。

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CHAT_TOOL_MAX_RESULT_BYTES,
  chatKnowledgeDimensionIds,
  executeChatTool,
  parseChatToolInvocation,
  type KnowledgeSearchToolResult,
  type RideHistoryToolResult,
  type TrainingLoadToolResult,
} from "../src/chat/chat-tools.ts";
import { computeRideTss } from "../src/domain/ride-training-stress.ts";
import { createUserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import { FileApplicationRepository } from "../src/persistence/application-repository.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";

function baseRecord(fixtureId: string, rideId: string): RideRecord {
  const fixture = getRideFixture(fixtureId);
  return {
    activity: { ...structuredClone(fixture.activity), rideId },
    series: { ...structuredClone(fixture.series), rideId },
  };
}

// 构造一条可算 TSS 的记录：用现有指标当形状模板，只覆盖 value，避免手写完整 metric 结构。
function tssRecord(fixtureId: string, rideId: string, startTime: string, normalizedPowerW: number, movingTimeS: number): RideRecord {
  const record = baseRecord(fixtureId, rideId);
  record.activity.startTime = startTime;
  const powerTemplate = record.activity.metrics.avgPowerW ?? record.activity.metrics.normalizedPowerW;
  assert.ok(powerTemplate, "fixture 必须带功率指标才能构造 TSS 记录");
  record.activity.metrics.normalizedPowerW = { ...powerTemplate, value: normalizedPowerW };
  const timeTemplate = record.activity.metrics.movingTimeS ?? record.activity.metrics.elapsedTimeS;
  assert.ok(timeTemplate, "fixture 必须带时长指标");
  record.activity.metrics.movingTimeS = { ...timeTemplate, value: movingTimeS };
  return record;
}

function withoutPower(fixtureId: string, rideId: string, startTime: string): RideRecord {
  const record = baseRecord(fixtureId, rideId);
  record.activity.startTime = startTime;
  delete record.activity.metrics.normalizedPowerW;
  delete record.activity.metrics.avgPowerW;
  delete record.activity.metrics.maxPowerW;
  return record;
}

async function withRepository(run: (repository: FileApplicationRepository) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "chat-b1-"));
  try {
    await run(new FileApplicationRepository(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// ---- TSS 计算（B1 新增的领域链路）----

test("AGT-B1 TSS：IF²×movingTimeS×100，严格对齐 V2.1 spec（无 elapsed 退回）", () => {
  // IF = 200/200 = 1.0 → TSS = 1² × 1h × 100 = 100
  const oneHour = computeRideTss({ normalizedPowerW: 200, ftpWatts: 200, movingTimeS: 3_600 });
  assert.equal(oneHour.status, "available");
  assert.equal(oneHour.status === "available" ? oneHour.tss : 0, 100);
  assert.equal(oneHour.status === "available" ? oneHour.intensityFactor : 0, 1);

  // IF = 242/200 = 1.21 → TSS ≈ 1.4641 × 0.5h × 100 ≈ 73.2
  const halfHour = computeRideTss({ normalizedPowerW: 242, ftpWatts: 200, movingTimeS: 1_800 });
  assert.equal(halfHour.status, "available");
  assert.equal(halfHour.status === "available" ? halfHour.tss : 0, 73.2);

  // 验收修正口径：spec 依赖只有 timing.movingTimeS，缺失一律 unavailable
  // （初版曾退回 elapsedTimeS——通勤骑会把停歇算进负荷，已删）。
  assert.equal((computeRideTss({ normalizedPowerW: 200, ftpWatts: 200 }) as { reason?: string }).reason, "DURATION_MISSING");
});

test("AGT-B1 TSS：输入缺失或非法一律 unavailable，不估算", () => {
  assert.equal((computeRideTss({ normalizedPowerW: 200, movingTimeS: 3_600 }) as { reason?: string }).reason, "FTP_MISSING");
  assert.equal((computeRideTss({ ftpWatts: 200, movingTimeS: 3_600 }) as { reason?: string }).reason, "POWER_MISSING");
  assert.equal((computeRideTss({ normalizedPowerW: 200, ftpWatts: 200, movingTimeS: 0 }) as { reason?: string }).reason, "DURATION_MISSING");
  assert.equal((computeRideTss({ normalizedPowerW: 200, ftpWatts: 0, movingTimeS: 3_600 }) as { reason?: string }).reason, "FTP_MISSING");
});

// ---- get_health_profile ----

test("AGT-B1 health_profile：只投影三项 + provenance，system_estimated 原样透出", async () => {
  await withRepository(async (repository) => {
    const profile = createUserProfile({ weightKg: 72, ftpWatts: 220, age: 28 });
    await repository.saveProfile("owner-a", profile);
    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_health_profile",
      input: { fields: ["weightKg", "maxHeartRate", "ftp"] },
    })) as { facts: Array<{ key: string; value: number; provenance: string }>; limitations: string[]; privacy: string[] };

    const weight = result.facts.find((fact) => fact.key === "weightKg");
    assert.equal(weight?.value, 72);
    // maxHeartRate 由 age 估算而来，provenance 必须是 system_estimated（模型不得说成实测）
    const maxHr = result.facts.find((fact) => fact.key === "maxHeartRate");
    assert.equal(maxHr?.provenance, "system_estimated");
    assert.equal(result.facts.find((fact) => fact.key === "ftp")?.value, 220);
    assert.deepEqual(result.privacy, ["identity_fields_excluded", "non_sport_health_fields_excluded"]);
    // 身高不在投影白名单里（D-B6）
    assert.equal(JSON.stringify(result).includes("heightCm"), false);
  });
});

test("AGT-B1 health_profile：无资料时 facts 为空、缺失项进 limitations（不编造）", async () => {
  await withRepository(async (repository) => {
    const result = await executeChatTool(repository, "owner-empty", parseChatToolInvocation({
      tool: "get_health_profile",
      input: { fields: ["weightKg", "ftp"] },
    })) as { facts: unknown[]; limitations: string[] };
    assert.deepEqual(result.facts, []);
    assert.deepEqual(result.limitations, ["weightKg:MISSING", "ftp:MISSING"]);
  });
});

test("AGT-B1 health_profile：按 fields 精确过滤（不多给）", async () => {
  await withRepository(async (repository) => {
    await repository.saveProfile("owner-a", createUserProfile({ weightKg: 72, ftpWatts: 220, age: 28 }));
    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_health_profile",
      input: { fields: ["ftp"] },
    })) as { facts: Array<{ key: string }> };
    assert.deepEqual(result.facts.map((fact) => fact.key), ["ftp"]);
  });
});

// ---- search_knowledge_base ----

test("AGT-B1 KB：维度检索命中、摘要截断、knowledgeId 可引用", async () => {
  await withRepository(async (repository) => {
    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "search_knowledge_base",
      input: { dimensionIds: ["pacingExecution"], keywords: [], maxEntries: 3 },
    })) as KnowledgeSearchToolResult;

    assert.equal(result.status, "matched");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.knowledgeId, "kb-v21-pacingExecution");
    assert.equal(result.items[0]?.dimensionId, "pacingExecution");
    // excerpt 上限 600 字（KB 单条 explanation 约 3KB，必须裁）
    assert.ok((result.items[0]?.excerpt.length ?? 0) <= 600, "excerpt 超过 600 字");
    assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= CHAT_TOOL_MAX_RESULT_BYTES);
  });
});

test("AGT-B1 KB：关键词检索命中；无匹配词返回 no_match + 可用维度清单", async () => {
  await withRepository(async (repository) => {
    const hit = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "search_knowledge_base",
      input: { dimensionIds: [], keywords: ["负分割"], maxEntries: 3 },
    })) as KnowledgeSearchToolResult;
    assert.equal(hit.status, "matched");
    assert.ok(hit.items.some((item) => item.knowledgeId === "kb-v21-pacingExecution"));

    const miss = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "search_knowledge_base",
      input: { dimensionIds: [], keywords: ["完全不存在的术语xyz"], maxEntries: 3 },
    })) as KnowledgeSearchToolResult;
    assert.equal(miss.status, "no_match");
    assert.deepEqual(miss.items, []);
    // 未命中要给可用维度，让模型改问而不是编条目
    assert.deepEqual(miss.availableDimensionIds, [...chatKnowledgeDimensionIds]);
  });
});

test("AGT-B1 KB：maxEntries 上限生效，且结果不超 32KB", async () => {
  await withRepository(async (repository) => {
    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "search_knowledge_base",
      input: { dimensionIds: [...chatKnowledgeDimensionIds], keywords: [], maxEntries: 3 },
    })) as KnowledgeSearchToolResult;
    assert.equal(result.items.length, 3);
    assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= CHAT_TOOL_MAX_RESULT_BYTES);
    // 维度全开时应按 KB 原顺序取前 3 条（排序稳定可复现）
    assert.deepEqual(result.items.map((item) => item.dimensionId), ["pacingExecution", "climbPerformance", "heartRateLoad"]);
  });
});

test("AGT-B1 KB：多维度部分覆盖时只返回真正命中的条目（不凑数）", async () => {
  await withRepository(async (repository) => {
    // 同时请求两个维度 + 一个只对配速条有明显命中的关键词 → 结果集应被关键词收窄
    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "search_knowledge_base",
      input: { dimensionIds: ["pacingExecution", "cadenceStrategy"], keywords: ["负分割"], maxEntries: 3 },
    })) as KnowledgeSearchToolResult;
    assert.equal(result.status, "matched");
    // 维度命中优先：两个维度都在集内，但关键词只命中配速 → 配速排第一
    assert.equal(result.items[0]?.knowledgeId, "kb-v21-pacingExecution");
    // 请求的维度集合原样回传（便于模型判断"我问的两块里哪块没查到"）
    assert.deepEqual(result.dimensionIds, ["pacingExecution", "cadenceStrategy"]);
  });
});

test("AGT-B1 KB：维度与关键词都空被判非法调用（不让空查询进执行层）", () => {
  assert.throws(() => parseChatToolInvocation({
    tool: "search_knowledge_base",
    input: { dimensionIds: [], keywords: [], maxEntries: 3 },
  }), (error) => (error as { code?: string }).code === "INVALID_INPUT");
});

// ---- get_training_load ----

test("AGT-B1 training_load：FTP 未确认 → FTP_NOT_CONFIRMED（不估算 TSS）", async () => {
  await withRepository(async (repository) => {
    await repository.saveRide("owner-a", tssRecord("l3-fit-power", "ride-1", "2026-08-01T02:00:00.000Z", 200, 3_600));
    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_training_load",
      input: { anchorDate: "2026-09-15", windowDays: 42 },
    })) as TrainingLoadToolResult;

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "FTP_NOT_CONFIRMED");
    assert.deepEqual(result.claims, []);
  });
});

test("AGT-B1 training_load：有 FTP 但无功率记录 → NO_TSS_HISTORY + 原因聚合", async () => {
  await withRepository(async (repository) => {
    await repository.saveProfile("owner-a", createUserProfile({ ftpWatts: 200 }));
    await repository.saveRide("owner-a", withoutPower("l3-fit-power", "ride-1", "2026-08-01T02:00:00.000Z"));
    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_training_load",
      input: { anchorDate: "2026-09-15", windowDays: 42 },
    })) as TrainingLoadToolResult;

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "NO_TSS_HISTORY");
    assert.ok(result.limitations.some((item) => item.startsWith("rides_without_tss:POWER_MISSING:")), "缺少功率原因未聚合");
  });
});

test("AGT-B1 training_load：跨度不足 42 天 → INSUFFICIENT_WINDOW", async () => {
  await withRepository(async (repository) => {
    await repository.saveProfile("owner-a", createUserProfile({ ftpWatts: 200 }));
    await repository.saveRide("owner-a", tssRecord("l3-fit-power", "ride-1", "2026-09-10T02:00:00.000Z", 200, 3_600));
    await repository.saveRide("owner-a", tssRecord("l3-fit-power", "ride-2", "2026-09-14T02:00:00.000Z", 200, 3_600));
    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_training_load",
      input: { anchorDate: "2026-09-15", windowDays: 42 },
    })) as TrainingLoadToolResult;

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "INSUFFICIENT_WINDOW");
  });
});

test("AGT-B1 training_load：跨度够但负荷日不足 10 天 → INSUFFICIENT_LOAD_DAYS", async () => {
  await withRepository(async (repository) => {
    await repository.saveProfile("owner-a", createUserProfile({ ftpWatts: 200 }));
    // 跨 46 天（窗口够）但只有 3 个负荷日（< RIDE_PMC_MIN_LOAD_DAYS=10）
    for (const [index, start] of ["08-01", "08-20", "09-15"].entries()) {
      await repository.saveRide("owner-a", tssRecord("l3-fit-power", `ride-${index}`, `2026-${start}T02:00:00.000Z`, 200, 3_600));
    }
    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_training_load",
      input: { anchorDate: "2026-09-15", windowDays: 42 },
    })) as TrainingLoadToolResult;

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "INSUFFICIENT_LOAD_DAYS");
  });
});

test("AGT-B1 training_load：可用时给出 CTL/ATL/TSB 与可引用 claims", async () => {
  await withRepository(async (repository) => {
    await repository.saveProfile("owner-a", createUserProfile({ ftpWatts: 200 }));
    // 10 条负荷、跨度 46 天（≥42 天窗口、≥10 个负荷日）：08-01 起每 5 天一条 → 09-15
    const starts = ["08-01", "08-06", "08-11", "08-16", "08-21", "08-26", "08-31", "09-05", "09-10", "09-15"];
    for (const [index, start] of starts.entries()) {
      await repository.saveRide(
        "owner-a",
        tssRecord("l3-fit-power", `ride-${index}`, `2026-${start}T02:00:00.000Z`, 200, 3_600),
      );
    }
    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_training_load",
      input: { anchorDate: "2026-09-15", windowDays: 42 },
    })) as TrainingLoadToolResult;

    assert.equal(result.status, "available");
    assert.ok(typeof result.ctl === "number" && typeof result.atl === "number" && typeof result.tsb === "number");
    assert.ok((result.loadDays ?? 0) >= 10);
    // claim 必须可被输出合同引用（claimId 形如 claim:training-load:v2:*）
    assert.ok(result.claims.length >= 3);
    assert.ok(result.claims.every((claim) => claim.claimId.startsWith("claim:training-load:v2:")));
  });
});

// AGT-B2 已实装 get_ride_history / get_route_overview，B1 期间"两工具仍抛
// TEMPORARY_UNAVAILABLE"的断言随之失效——相关行为改由 tests/chat-b2-ride-window.test.ts 覆盖。
