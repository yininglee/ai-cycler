// AGT-H1（SD-4）：记录选择（rideRef）单测。
//
// 归口细规划 H1 退出条件：**同日两条 fixture 下点选/日期/序数三路全部唯一定位**、
// `candidates` 字段有单测。这里对"三路"的口径写清楚（也是实现的口径）：
//   · 点选（`{rideId}`）—— 唯一 ✅（这正是 rideId 存在的理由）
//   · 日期（`{date}`）  —— **同日两条时不可能唯一**，所以正确答案是 `ambiguous` + 两条候选，
//                          而不是"取出发较晚那条"（旧实现正是这么做的，是"另一次问不到"的根因）
//   · 序数（`{ordinal}`）—— 唯一 ✅（-1 较晚、-2 较早）
// 另覆盖：`need_reference` 不默认取最新、日期没找到 / 序数越界的候选、锚点层同日多条的确定性话术。

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CHAT_RIDE_REFERENCE_MAX_CANDIDATES,
  chatRideCandidateLabel,
  chatRideCandidates,
  chatRideRefReply,
  parseChatRideRef,
  resolveChatRideRef,
  rideRecordByOrdinal,
} from "../src/chat/chat-ride-ref.ts";
import { resolveAnchorConfirmation, resolveRideAnchor } from "../src/chat/chat-ride-anchor.ts";
import {
  executeChatTool,
  isRideReferencePending,
  parseChatToolInvocation,
  type RideContextToolResult,
  type RouteOverviewToolResult,
} from "../src/chat/chat-tools.ts";
import { createChatToolLoopRunner } from "../src/chat/chat-tool-orchestration.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import { FileApplicationRepository } from "../src/persistence/application-repository.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";

// 同一天两次：早上一次（有功率）、傍晚一次（同一份轨迹但摘掉功率——模拟没戴功率计）。
// 这样两条只差"有没有功率"，正好验证候选靠**时间 + 数据可用性**区分。
function sameDayRecords(): { morning: RideRecord; evening: RideRecord } {
  const build = (rideId: string, startTime: string): RideRecord => {
    const fixture = getRideFixture("l3-fit-power");
    return {
      activity: { ...structuredClone(fixture.activity), rideId, startTime },
      series: { ...structuredClone(fixture.series), rideId },
    };
  };
  const evening = build("ride-0820-pm", "2026-08-20T10:40:00Z");
  for (const key of ["avgPowerW", "maxPowerW", "normalizedPowerW"] as const) delete evening.activity.metrics[key];
  return {
    // 08:12 Asia/Shanghai（UTC 00:12）
    morning: build("ride-0820-am", "2026-08-20T00:12:00Z"),
    // 18:40 Asia/Shanghai（UTC 10:40）
    evening,
  };
}

const NOW = new Date("2026-09-09T00:00:00Z");

function entriesOf(records: RideRecord[]) {
  return records.map((record) => ({ record }));
}

async function withRepository(run: (repository: FileApplicationRepository) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "chat-h1-"));
  try {
    await run(new FileApplicationRepository(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 合同解析（rideRef 自身的正反例）
// ---------------------------------------------------------------------------

test("H1 rideRef 正例：三种形态各自通过", () => {
  assert.deepEqual(parseChatRideRef({ date: "2026-08-20" }), { date: "2026-08-20" });
  assert.deepEqual(parseChatRideRef({ ordinal: -1 }), { ordinal: -1 });
  assert.deepEqual(parseChatRideRef({ rideId: "upload-9f3a" }), { rideId: "upload-9f3a" });
});

test("H1 rideRef 反例：多键 / 非法日期 / ordinal 0 或正数 / 空白 rideId 一律判非法", () => {
  assert.equal(parseChatRideRef({ date: "2026-08-20", rideId: "r1" }), undefined);
  // 2 月 30 日不是真实日历日
  assert.equal(parseChatRideRef({ date: "2026-02-30" }), undefined);
  assert.equal(parseChatRideRef({ date: "08-20" }), undefined);
  assert.equal(parseChatRideRef({ ordinal: 0 }), undefined);
  assert.equal(parseChatRideRef({ ordinal: 1 }), undefined);
  assert.equal(parseChatRideRef({ ordinal: -1.5 }), undefined);
  assert.equal(parseChatRideRef({ rideId: "   " }), undefined);
  assert.equal(parseChatRideRef(null), undefined);
  assert.equal(parseChatRideRef("2026-08-20"), undefined);
});

// ---------------------------------------------------------------------------
// 同日两条：三路各自的行为
// ---------------------------------------------------------------------------

test("H1 同日两条 · 点选路：rideId 唯一定位（两条都能取到，互不串）", async () => {
  const { morning, evening } = sameDayRecords();
  await withRepository(async (repository) => {
    await repository.saveRide("owner-a", morning);
    await repository.saveRide("owner-a", evening);

    const am = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_ride_context",
      input: { rideRef: { rideId: "ride-0820-am" }, dims: ["summary"] },
    }));
    const pm = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_ride_context",
      input: { rideRef: { rideId: "ride-0820-pm" }, dims: ["summary"] },
    }));
    assert.equal(isRideReferencePending(am), false);
    assert.equal(isRideReferencePending(pm), false);
    assert.equal((am as RideContextToolResult).rideId, "ride-0820-am");
    assert.equal((pm as RideContextToolResult).rideId, "ride-0820-pm");
    // 同一天两条，日期标签相同——所以**只靠日期无法区分**，这才需要 rideId。
    assert.equal((am as RideContextToolResult).rideDateLabel, "2026年8月20日");
    assert.equal((pm as RideContextToolResult).rideDateLabel, "2026年8月20日");
  });
});

test("H1 同日两条 · 日期路：返回 ambiguous + 两条候选，**不**静默取最晚", () => {
  const { morning, evening } = sameDayRecords();
  const resolution = resolveChatRideRef({ ref: { date: "2026-08-20" }, entries: entriesOf([morning, evening]), now: NOW });
  assert.equal(resolution.status, "ambiguous");
  if (resolution.status !== "ambiguous") return;
  assert.equal(resolution.reason, "same_day_multiple");
  assert.equal(resolution.candidates.length, 2);
  // 候选按出发时间倒序：傍晚在前、早上在后；靠 timeLabel 区分同一天。
  assert.deepEqual(resolution.candidates.map((candidate) => candidate.rideId), ["ride-0820-pm", "ride-0820-am"]);
  assert.deepEqual(resolution.candidates.map((candidate) => candidate.timeLabel), ["18:40", "08:12"]);
  assert.match(chatRideRefReply(resolution, { dateLabel: "8月20日" }), /8月20日有 2 条骑行记录/);
});

test("H1 同日两条 · 序数路：-1 / -2 各自唯一定位", () => {
  const { morning, evening } = sameDayRecords();
  const entries = entriesOf([morning, evening]);
  const latest = resolveChatRideRef({ ref: { ordinal: -1 }, entries, now: NOW });
  const previous = resolveChatRideRef({ ref: { ordinal: -2 }, entries, now: NOW });
  assert.equal(latest.status, "resolved");
  assert.equal(previous.status, "resolved");
  if (latest.status === "resolved") assert.equal(latest.record.activity.rideId, "ride-0820-pm");
  if (previous.status === "resolved") assert.equal(previous.record.activity.rideId, "ride-0820-am");
  assert.equal(rideRecordByOrdinal(entries, 0), undefined, "序数 0 无意义");
  assert.equal(rideRecordByOrdinal(entries, -3), undefined, "只有两条记录");
});

// ---------------------------------------------------------------------------
// 候选字段与"不默认取最新"
// ---------------------------------------------------------------------------

test("H1 候选字段：rideId / 日期 / 时刻 / 距离 / 有无功率心率 齐全，且上限 5 条", () => {
  const { morning, evening } = sameDayRecords();
  const candidates = chatRideCandidates(entriesOf([morning, evening]));
  assert.equal(candidates.length, 2);
  const [eveningCandidate, morningCandidate] = candidates;
  assert.ok(eveningCandidate && morningCandidate);
  // 早上那次有功率、傍晚那次没有（摘掉了功率指标）；两次都有心率。
  assert.equal(morningCandidate.hasPower, true);
  assert.equal(eveningCandidate.hasPower, false);
  assert.equal(eveningCandidate.hasHeartRate, true);
  assert.ok(typeof morningCandidate.distanceKm === "number" && morningCandidate.distanceKm > 0);
  // 标签可读：日期 + 时刻 + 距离 + 数据可用性
  assert.match(chatRideCandidateLabel(morningCandidate), /^8月20日 08:12 · [\d.]+ km/);

  // 上限：11 条记录 → 只给最近 5 条（与 D-H1 展示密度对齐）
  const many = Array.from({ length: 11 }, (_, index) => {
    const record = structuredClone(morning);
    record.activity = { ...record.activity, rideId: `bulk-${index}`, startTime: new Date(Date.UTC(2026, 7, 1 + index, 1)).toISOString() };
    record.series = { ...record.series, rideId: `bulk-${index}` };
    return record;
  });
  const capped = chatRideCandidates(entriesOf(many));
  assert.equal(capped.length, CHAT_RIDE_REFERENCE_MAX_CANDIDATES);
  assert.equal(capped[0]?.rideId, "bulk-10", "最近一次在最前");
});

test("H1 need_reference：不给 rideRef 就返回候选，**绝不**默认取最新记录", () => {
  const { morning, evening } = sameDayRecords();
  const resolution = resolveChatRideRef({ entries: entriesOf([morning, evening]), now: NOW });
  assert.equal(resolution.status, "need_reference");
  if (resolution.status !== "need_reference") return;
  assert.equal(resolution.reason, "reference_missing");
  assert.equal(resolution.candidates.length, 2);
  // 关键：没有 record —— 调用方拿不到"悄悄选中的那条"
  assert.equal("record" in resolution, false);
  assert.match(chatRideRefReply(resolution), /你想分析哪一次骑行/);

  const empty = resolveChatRideRef({ entries: [] });
  assert.equal(empty.status, "need_reference");
  if (empty.status === "need_reference") {
    assert.equal(empty.reason, "no_records");
    assert.deepEqual(empty.candidates, []);
  }
});

test("H1 not_found：日期没记录 / 序数越界都带候选（用户下一句最想知道\"那有哪些\"）", () => {
  const { morning, evening } = sameDayRecords();
  const entries = entriesOf([morning, evening]);

  const missingDate = resolveChatRideRef({ ref: { date: "2026-07-04" }, entries, now: NOW });
  assert.equal(missingDate.status, "not_found");
  if (missingDate.status === "not_found") {
    assert.equal(missingDate.reason, "date_not_found");
    assert.equal(missingDate.candidates.length, 2);
    assert.match(chatRideRefReply(missingDate, { dateLabel: "7月4日" }), /没有找到 7月4日 的骑行记录。最近几次是/);
  }

  const outOfRange = resolveChatRideRef({ ref: { ordinal: -5 }, entries, now: NOW });
  assert.equal(outOfRange.status, "not_found");
  if (outOfRange.status === "not_found") {
    assert.equal(outOfRange.reason, "ordinal_out_of_range");
    assert.match(chatRideRefReply(outOfRange, { ordinal: -5 }), /没有找到倒数第 5 次骑行/);
  }
});

// ---------------------------------------------------------------------------
// 锚点层：同日多条不再取最晚
// ---------------------------------------------------------------------------

test("H1 锚点层：显式日期命中两条 → clarify(same_day_multiple) 并列出两条（旧实现取最晚）", () => {
  const { morning, evening } = sameDayRecords();
  const resolution = resolveRideAnchor({
    text: "8月20日那次的平均功率是多少？",
    route: "current_ride",
    summaries: [],
    entries: entriesOf([morning, evening]),
    now: NOW,
  });
  assert.equal(resolution.status, "clarify");
  if (resolution.status !== "clarify") return;
  assert.equal(resolution.reason, "same_day_multiple");
  assert.equal(resolution.candidates?.length, 2);
  assert.match(resolution.reply, /8月20日有 2 条骑行记录/);
});

test("H1 锚点层：确认轮给的日期命中两条 → 确定性回复列候选，不替用户选", () => {
  const { morning, evening } = sameDayRecords();
  const resolved = resolveAnchorConfirmation({
    confirmation: { type: "date", question: "本次骑行的平均功率是多少？", route: "current_ride", date: { year: 2026, month: 8, day: 20 } },
    entries: entriesOf([morning, evening]),
    now: NOW,
  });
  assert.equal(resolved.kind, "reply");
  if (resolved.kind === "reply") assert.match(resolved.reply, /8月20日有 2 条骑行记录/);
});

// ---------------------------------------------------------------------------
// 工具层：pending 是"请先选一条"，不是失败也不是空结果
// ---------------------------------------------------------------------------

test("H1 工具层：日期命中两条 → pending(ambiguous) 带候选；序数越界 → pending(not_found)", async () => {
  const { morning, evening } = sameDayRecords();
  await withRepository(async (repository) => {
    await repository.saveRide("owner-a", morning);
    await repository.saveRide("owner-a", evening);

    const byDate = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_route_overview",
      input: { rideRef: { date: "2026-08-20" }, segments: 3 },
    }));
    assert.equal(isRideReferencePending(byDate), true);
    if (!isRideReferencePending(byDate)) return;
    assert.equal(byDate.status, "ambiguous");
    assert.equal(byDate.tool, "get_route_overview");
    assert.equal(byDate.candidates.length, 2);
    assert.deepEqual(byDate.limitations, ["ride_reference:same_day_multiple"]);

    const byOrdinal = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_ride_context",
      input: { rideRef: { ordinal: -9 }, dims: ["summary"] },
    }));
    assert.equal(isRideReferencePending(byOrdinal), true);
    if (isRideReferencePending(byOrdinal)) assert.equal(byOrdinal.reason, "ordinal_out_of_range");
  });
});

test("H1 工具层：序数 -2 取到同日较早那条（不是最新）", async () => {
  const { morning, evening } = sameDayRecords();
  await withRepository(async (repository) => {
    await repository.saveRide("owner-a", morning);
    await repository.saveRide("owner-a", evening);

    const result = await executeChatTool(repository, "owner-a", parseChatToolInvocation({
      tool: "get_route_overview",
      input: { rideRef: { ordinal: -2 }, segments: 2 },
    }));
    assert.equal(isRideReferencePending(result), false);
    assert.equal((result as RouteOverviewToolResult).rideId, "ride-0820-am");
  });
});

test("H1 工具层：他人记录用 rideId 指定 → 仍走归属校验（NOT_FOUND），不降级成候选", async () => {
  const { morning } = sameDayRecords();
  await withRepository(async (repository) => {
    await repository.saveRide("owner-b", morning);
    await assert.rejects(
      executeChatTool(repository, "owner-a", parseChatToolInvocation({
        tool: "get_ride_context",
        input: { rideRef: { rideId: "ride-0820-am" }, dims: ["summary"] },
      })),
      (error) => (error as { code?: string }).code === "NOT_FOUND",
    );
  });
});

// ---------------------------------------------------------------------------
// 循环层：回执形态（H2 将据此产出 choices）
// ---------------------------------------------------------------------------

test("H1 循环层：模型传入同日日期 → 回执 reference_pending（不是失败、不是空结果）", async () => {
  const { morning, evening } = sameDayRecords();
  await withRepository(async (repository) => {
    await repository.saveRide("owner-a", morning);
    await repository.saveRide("owner-a", evening);
    const runner = createChatToolLoopRunner(repository, "owner-a");
    const receipts = await runner.executeLoopCalls({
      calls: [{ tool: "get_ride_context", input: { rideRef: { date: "2026-08-20" }, dims: ["summary"] } }],
      anchorRideId: "ride-0820-am",
      allowedRideIds: ["ride-0820-am", "ride-0820-pm"],
    });
    assert.equal(receipts.length, 1);
    const receipt = receipts[0]!;
    assert.equal(receipt.status, "reference_pending");
    if (receipt.status !== "reference_pending") return;
    assert.equal(receipt.pendingStatus, "ambiguous");
    assert.equal(receipt.reason, "same_day_multiple");
    assert.equal(receipt.candidates.length, 2);
  });
});

test("H1 循环层：**没有锚点也不给指涉 → need_reference**，绝不默认取最新", async () => {
  const { morning, evening } = sameDayRecords();
  await withRepository(async (repository) => {
    await repository.saveRide("owner-a", morning);
    await repository.saveRide("owner-a", evening);
    const runner = createChatToolLoopRunner(repository, "owner-a");
    const receipts = await runner.executeLoopCalls({
      calls: [{ tool: "get_ride_context", input: { dims: ["summary"] } }],
      anchorRideId: "",
      allowedRideIds: [],
    });
    const receipt = receipts[0]!;
    assert.equal(receipt.status, "reference_pending");
    if (receipt.status !== "reference_pending") return;
    assert.equal(receipt.pendingStatus, "need_reference");
    assert.equal(receipt.reason, "reference_missing");
    assert.equal(receipt.candidates.length, 2, "候选仍要给——用户下一句就要点");
  });
});

test("H1 循环层：模型编造的 rideRef.rideId 不在允许集合 → RIDE_NOT_ALLOWED（不放行越权/编造 id）", async () => {
  const { morning } = sameDayRecords();
  await withRepository(async (repository) => {
    await repository.saveRide("owner-a", morning);
    const runner = createChatToolLoopRunner(repository, "owner-a");
    const receipts = await runner.executeLoopCalls({
      calls: [{ tool: "get_ride_context", input: { rideRef: { rideId: "made-up-id" }, dims: ["summary"] } }],
      anchorRideId: "ride-0820-am",
      allowedRideIds: ["ride-0820-am"],
    });
    const receipt = receipts[0]!;
    assert.equal(receipt.status, "rejected");
    if (receipt.status === "rejected") assert.equal(receipt.errorCode, "RIDE_NOT_ALLOWED");
  });
});
