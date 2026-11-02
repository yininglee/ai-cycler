// AGT-B2：记录窗口工具组（get_ride_history / get_route_overview）+ find_ride 窗口解冻单测。
//
// 归口细规划 §7 AGT-B2 退出条件：窗口边界（1 天 / 365 天 / 366 拒绝 / 无记录 / 指标缺失）、
// `find_ride` 解冻后"缺省仍 30 天"不变、路线不可用时不编造。

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runChatAgent, type ChatProvider } from "../src/chat/chat-agent.ts";
import { createChatToolLoopRunner } from "../src/chat/chat-tool-orchestration.ts";
import {
  CHAT_COMPARISON_WINDOW_DAYS,
  CHAT_FIND_RIDE_MAX_WINDOW_DAYS,
  CHAT_RIDE_HISTORY_DEFAULT_WINDOW_DAYS,
  CHAT_RIDE_HISTORY_MAX_ROWS,
  CHAT_RIDE_HISTORY_MAX_WINDOW_DAYS,
  CHAT_TOOL_MAX_RESULT_BYTES,
  executeChatTool,
  parseChatToolInvocation,
  type RouteOverviewToolResult,
} from "../src/chat/chat-tools.ts";
import { classifyChatInput } from "../src/chat/chat-routing.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import { FileApplicationRepository } from "../src/persistence/application-repository.ts";
import type { ApplicationRepository } from "../src/persistence/application-repository.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";

type RideHistoryResult = Awaited<ReturnType<typeof executeChatTool>> & { rideCount?: number };

function recordFrom(fixtureId: string, rideId: string, daysAgo: number): RideRecord {
  const fixture = getRideFixture(fixtureId);
  const record: RideRecord = {
    activity: { ...structuredClone(fixture.activity), rideId },
    series: { ...structuredClone(fixture.series), rideId },
  };
  record.activity.startTime = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return record;
}

function withoutElevation(fixtureId: string, rideId: string, daysAgo: number): RideRecord {
  const record = recordFrom(fixtureId, rideId, daysAgo);
  for (const point of record.series.points) delete point.elevationM;
  return record;
}

/** 在真实轨迹上叠加 5% 持续上坡（不动点数/距离/时间），用来验证爬坡段分支。 */
function climbRecord(fixtureId: string, rideId: string, daysAgo: number): RideRecord {
  const record = recordFrom(fixtureId, rideId, daysAgo);
  for (const point of record.series.points) {
    if (typeof point.elevationM === "number" && typeof point.distanceM === "number") {
      point.elevationM += point.distanceM * 0.05;
    }
  }
  return record;
}

async function withRepository(run: (repository: FileApplicationRepository) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "chat-b2-"));
  try {
    await run(new FileApplicationRepository(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// ---- 窗口口径与解冻 ----

test("AGT-B2：find_ride 上限解冻到 365，缺省仍是 30（D-B1 职责分离）", () => {
  assert.equal(CHAT_FIND_RIDE_MAX_WINDOW_DAYS, 365);
  // 缺省窗口不放大——"哪次最远"在未明示窗口时仍按近 30 天回答。
  assert.equal(CHAT_COMPARISON_WINDOW_DAYS, 30);
  assert.equal(parseChatToolInvocation({ tool: "find_ride", input: { rideId: "r", metric: "distanceM", mode: "max", metrics: ["distanceM"], windowDays: 365 } }).tool, "find_ride");
  assert.throws(() => parseChatToolInvocation({ tool: "find_ride", input: { rideId: "r", metric: "distanceM", mode: "max", metrics: ["distanceM"], windowDays: 366 } }), (error) => (error as { code?: string }).code === "INVALID_INPUT");
  assert.equal(CHAT_RIDE_HISTORY_DEFAULT_WINDOW_DAYS, 90);
  assert.equal(CHAT_RIDE_HISTORY_MAX_WINDOW_DAYS, 365);
});

test("AGT-B2：get_ride_history 窗口边界 1 / 365 / 366", () => {
  assert.equal(parseChatToolInvocation({ tool: "get_ride_history", input: { rideId: null, windowDays: 1, metrics: ["distanceM"] } }).tool, "get_ride_history");
  assert.equal(parseChatToolInvocation({ tool: "get_ride_history", input: { rideId: null, windowDays: 365, metrics: ["distanceM"] } }).tool, "get_ride_history");
  assert.throws(() => parseChatToolInvocation({ tool: "get_ride_history", input: { rideId: null, windowDays: 366, metrics: ["distanceM"] } }), (error) => (error as { code?: string }).code === "INVALID_INPUT");
  assert.throws(() => parseChatToolInvocation({ tool: "get_ride_history", input: { rideId: null, windowDays: 0, metrics: ["distanceM"] } }), (error) => (error as { code?: string }).code === "INVALID_INPUT");
});

// ---- get_ride_history ----

test("AGT-B2 history：窗口收缩按日历日生效，统计覆盖窗口内全部记录", async () => {
  await withRepository(async (repository) => {
    await repository.saveRide("owner-a", recordFrom("l3-fit-power", "today", 0));
    await repository.saveRide("owner-a", recordFrom("l3-fit-power", "d10", 10));
    await repository.saveRide("owner-a", recordFrom("l3-fit-power", "d100", 100));

    const ninety = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_ride_history",
      input: { rideId: null, windowDays: 90, metrics: ["distanceM"] },
    })) as { rideCount: number; status: string; rows: unknown[] };
    assert.equal(ninety.rideCount, 2);
    assert.equal(ninety.rows.length, 2);

    const oneDay = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_ride_history",
      input: { rideId: null, windowDays: 1, metrics: ["distanceM"] },
    })) as { rideCount: number };
    assert.equal(oneDay.rideCount, 1);

    const year = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_ride_history",
      input: { rideId: null, windowDays: 365, metrics: ["distanceM"] },
    })) as { rideCount: number };
    assert.equal(year.rideCount, 3);
  });
});

test("AGT-B2 history：汇总 claims 用领域指标键，里程可按公里呈现", async () => {
  await withRepository(async (repository) => {
    await repository.saveRide("owner-a", recordFrom("l3-fit-power", "r1", 5));
    await repository.saveRide("owner-a", recordFrom("l3-fit-power", "r2", 6));
    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_ride_history",
      input: { rideId: null, windowDays: 30, metrics: ["distanceM"] },
    })) as { claims: Array<{ claimId: string; key: string; value: number; unit: string }> };

    const distance = result.claims.find((claim) => claim.claimId.includes("totalDistanceM"));
    assert.ok(distance, "缺总里程 claim");
    assert.equal(distance.unit, "m");
    // key 必须是 distanceM —— 否则等价类不会补 km 呈现，模型说"32 公里"会被判幻觉
    assert.equal(distance.key, "distanceM");
    assert.equal(result.claims.find((claim) => claim.key === "rideCount")?.value, 2);
  });
});

test("AGT-B2 history：逐条行按时间倒序；锚定某条时窗口以它为终点", async () => {
  await withRepository(async (repository) => {
    await repository.saveRide("owner-a", recordFrom("l3-fit-power", "old", 60));
    await repository.saveRide("owner-a", recordFrom("l3-fit-power", "mid", 30));
    await repository.saveRide("owner-a", recordFrom("l3-fit-power", "new", 1));

    const descending = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_ride_history",
      input: { rideId: null, windowDays: 90, metrics: ["distanceM"] },
    })) as { rows: Array<{ rideId: string }> };
    assert.deepEqual(descending.rows.map((row) => row.rideId), ["new", "mid", "old"]);

    // 锚定 "mid"（30 天前）：窗口从该日向前数 15 天 → 覆盖 30..44 天前，只含 mid
    // （old 在 60 天前，超出窗口；这也验证"窗口终点是锚定日"而不是今天）
    const anchored = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_ride_history",
      input: { rideId: "mid", windowDays: 15, metrics: ["distanceM"] },
    })) as { rows: Array<{ rideId: string }>; anchorStartTime?: string };
    assert.deepEqual(anchored.rows.map((row) => row.rideId), ["mid"]);
    assert.ok(anchored.anchorStartTime, "锚定时应回传 anchorStartTime（供日期数字白名单）");
  });
});

test("AGT-B2 history：窗口内无记录 → no_match + NO_RIDES_IN_WINDOW，不编造汇总", async () => {
  await withRepository(async (repository) => {
    await repository.saveRide("owner-a", recordFrom("l3-fit-power", "old", 200));
    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_ride_history",
      input: { rideId: null, windowDays: 30, metrics: ["distanceM"] },
    })) as { status: string; reasonCodes: string[]; rideCount: number; rows: unknown[] };

    assert.equal(result.status, "no_match");
    assert.deepEqual(result.reasonCodes, ["NO_RIDES_IN_WINDOW"]);
    assert.equal(result.rideCount, 0);
    assert.deepEqual(result.rows, []);
  });
});

test("AGT-B2 history：指标缺失记 METRIC_MISSING，逐条行被截断时进 limitations", async () => {
  await withRepository(async (repository) => {
    // 无爬升指标 → METRIC_MISSING；同时灌 25 条记录触发行截断
    for (let index = 0; index < CHAT_RIDE_HISTORY_MAX_ROWS + 5; index += 1) {
      const record = recordFrom("fit-heart-rate-dropout", `r${index}`, index + 1);
      await repository.saveRide("owner-a", record);
    }
    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_ride_history",
      input: { rideId: null, windowDays: 90, metrics: ["distanceM"] },
    })) as { rideCount: number; rows: unknown[]; limitations: string[]; reasonCodes: string[] };

    assert.equal(result.rideCount, CHAT_RIDE_HISTORY_MAX_ROWS + 5);
    assert.equal(result.rows.length, CHAT_RIDE_HISTORY_MAX_ROWS);
    assert.ok(result.limitations.some((item) => item.startsWith("rows_truncated:")));
    assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= CHAT_TOOL_MAX_RESULT_BYTES);
  });
});

test("AGT-B2 history：他人记录不可锚定（NOT_FOUND），不泄露存在性以外的信息", async () => {
  await withRepository(async (repository) => {
    await repository.saveRide("owner-b", recordFrom("l3-fit-power", "other-ride", 5));
    await assert.rejects(
      executeChatTool(repository, "owner-a", parseChatToolInvocation({
        tool: "get_ride_history",
        input: { rideId: "other-ride", windowDays: 90, metrics: ["distanceM"] },
      })),
      (error) => (error as { code?: string }).code === "NOT_FOUND",
    );
  });
});

// ---- get_route_overview ----

test("AGT-B2 route：平路轨迹给出占比但不编造爬坡段", async () => {
  await withRepository(async (repository) => {
    await repository.saveRide("owner-a", recordFrom("l3-power-preview", "flat", 3));
    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_route_overview",
      input: { rideId: "flat", segments: 3 },
    })) as RouteOverviewToolResult;

    assert.equal(result.isAvailable, true);
    assert.ok((result.flatDistanceM ?? 0) > 0);
    assert.deepEqual(result.climbs, [], "平路不应产生爬坡段");
    assert.equal(result.longestClimb, undefined);
    assert.deepEqual(result.privacy, ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"]);
  });
});

test("AGT-B2 route：有坡度时按里程降序返回爬坡段，segments 控制条数", async () => {
  await withRepository(async (repository) => {
    await repository.saveRide("owner-a", climbRecord("l3-power-preview", "climb", 3));

    const three = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_route_overview",
      input: { rideId: "climb", segments: 3 },
    })) as RouteOverviewToolResult;
    assert.equal(three.isAvailable, true);
    assert.ok(three.climbs.length >= 1);
    assert.equal(three.longestClimb?.distanceM, three.climbs[0]?.distanceM);
    // 降序
    for (let index = 1; index < three.climbs.length; index += 1) {
      assert.ok((three.climbs[index - 1]?.distanceM ?? 0) >= (three.climbs[index]?.distanceM ?? 0));
    }
    // 里程取整到米（投影不收口会喂给模型一长串小数）
    assert.ok(Number.isInteger(three.climbs[0]?.distanceM));

    const one = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_route_overview",
      input: { rideId: "climb", segments: 1 },
    })) as RouteOverviewToolResult;
    assert.equal(one.climbs.length, 1);
  });
});

test("AGT-B2 route：无海拔数据 → isAvailable=false，不给任何里程数字（0 会被叙述成全是平路）", async () => {
  await withRepository(async (repository) => {
    await repository.saveRide("owner-a", withoutElevation("fit-heart-rate-dropout", "no-elev", 3));
    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_route_overview",
      input: { rideId: "no-elev", segments: 3 },
    })) as RouteOverviewToolResult;

    assert.equal(result.isAvailable, false);
    assert.equal(result.climbDistanceM, undefined);
    assert.equal(result.flatDistanceM, undefined);
    assert.equal(result.descentDistanceM, undefined);
    assert.deepEqual(result.climbs, []);
    assert.deepEqual(result.claims, []);
    assert.ok(result.limitations.includes("route_shape:NOT_AVAILABLE"));
  });
});

test("AGT-B2 route：他人记录 → NOT_FOUND（越权 rideId 不得读出）", async () => {
  await withRepository(async (repository) => {
    await repository.saveRide("owner-b", recordFrom("l3-power-preview", "other", 3));
    await assert.rejects(
      executeChatTool(repository, "owner-a", parseChatToolInvocation({
        tool: "get_route_overview",
        input: { rideId: "other", segments: 3 },
      })),
      (error) => (error as { code?: string }).code === "NOT_FOUND",
    );
  });
});

// ---- B2 验收补充：解冻后"缺省仍 30"的行为级验证（退出条件明确要求，非仅常量断言）----

class SequenceProvider implements ChatProvider {
  calls: Parameters<ChatProvider["run"]>[0][] = [];
  private index = 0;
  private readonly responses: string[];
  constructor(responses: string[]) {
    this.responses = responses;
  }
  async run(input: Parameters<ChatProvider["run"]>[0]) {
    this.calls.push(input);
    return { rawText: this.responses[Math.min(this.index++, this.responses.length - 1)]! };
  }
}

function loopRecord(fixtureId: string, rideId: string, daysAgo: number, distanceKm: number): RideRecord {
  const record = recordFrom(fixtureId, rideId, daysAgo);
  const originalDistanceM = record.activity.metrics.distanceM!.value;
  const avgSpeed = record.activity.metrics.avgSpeedMps;
  record.activity.metrics.distanceM = { ...record.activity.metrics.distanceM!, value: distanceKm * 1_000 };
  if (avgSpeed) {
    record.activity.metrics.avgSpeedMps = { ...avgSpeed, value: (avgSpeed.value * distanceKm * 1_000) / originalDistanceM };
  }
  return record;
}

function loopRepository(records: Record<string, RideRecord>, rideIds: readonly string[]): ApplicationRepository {
  return {
    listRides: async (ownerId: string) => ownerId === "owner-a"
      ? rideIds.map((rideId) => ({ record: records[rideId]!, storedAt: "2026-09-05T00:00:00.000Z" }))
      : [],
    getRide: async (ownerId: string, rideId: string) => (ownerId === "owner-a" ? records[rideId] ?? null : null),
    getProfile: async () => null,
  } as unknown as ApplicationRepository;
}

test("AGT-B2 验收：模型不带 windowDays 时按 30 天执行，窗口外记录不命中（P7 语义）", async () => {
  // 100 天前有一条 55km（更远）、今天有一条 42km。模型问"哪次最远"且不带 windowDays。
  const records: Record<string, RideRecord> = {
    "anchor-ride": loopRecord("l3-fit-power", "anchor-ride", 0, 42),
    "old-ride": loopRecord("l3-fit-power", "old-ride", 100, 55),
  };
  const repository = loopRepository(records, ["anchor-ride", "old-ride"]);
  const provider = new SequenceProvider([
    JSON.stringify({
      schemaVersion: "ride-chat-tool-call-v0.1",
      calls: [{ tool: "find_ride", input: { rideId: null, metric: "distanceM", mode: "max", metrics: ["distanceM"] } }],
    }),
    JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", route: "autonomous_tools", reply: "最近一个月最远是 42 公里。", claimIds: ["claim:loop:1:1"], capabilityKeys: [] }),
  ]);

  const result = await runChatAgent({
    text: "哪次骑行距离最远？",
    decision: classifyChatInput("哪次骑行距离最远？"),
    provider,
    toolRunner: undefined,
    loopRunner: createChatToolLoopRunner(repository, "owner-a"),
  });
  assert.equal(result.execution, "validated", "最终回答应通过校验");

  // 从第二轮 provider 输入里读 find_ride 的实际执行结果：windowDays 必须是注入的 30。
  const findResult = (provider.calls[1]?.toolResults ?? [])[0]?.context as {
    windowDays?: number;
    matches?: Array<{ rideId: string }>;
  };
  assert.equal(findResult?.windowDays, 30, "缺省窗口必须是 30 天（D-B1：未明示窗口不放大）");
  // 100 天前的 55km 必须不命中——这就是"解冻只放开显式请求"的语义。
  assert.ok((findResult?.matches ?? []).every((match) => match.rideId !== "old-ride"), "缺省窗口不应命中 100 天前的记录");
});
