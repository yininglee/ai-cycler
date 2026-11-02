import { lastChatRideChoice } from "./chat-context.ts";
import { rideRecordByOrdinal } from "./chat-ride-ref.ts";
import type { RideRecord } from "../domain/ride-schema.ts";
import { classifyChatInput, type ChatRoute, type ChatRoutingDecision, type ChatSessionSummary } from "./chat-routing.ts";
import {
  chatRideCandidateLabel,
  chatRideCandidates,
  chatRideRefReply,
  findRideRecordsByDate,
  latestRideRecord,
  rideAnchorDate,
  rideAnchorDateLabel,
  parseRideAnchorDate,
  type ChatRideCandidate,
  type ChatRideRefReason,
  type RideAnchorDate,
} from "./chat-ride-ref.ts";

// CHAT-14 P2（G-RIDE-DEIXIS，架构设计 v0.4 4.2.2 节）：骑乘指涉解析——
// “本次/这次/当前”与裸指标词不再静默锚定最新记录；锚点来源次序：
// 显式日期 → 显式序数 → 上下文继承 → 确认/澄清。锚点以记录日期（Asia/Shanghai 的
// YYYY-MM-DD）存储而非“最新”指针：会话中导入新记录不偷换已建立锚点。
// 锚点解析只做服务端 owner 范围内的记录选择，路由仍只看本轮 text。
//
// AGT-H1（SD-4）：**记录选择下沉**——日期/序数的解析与候选构造移到 `chat-ride-ref.ts`，
// 本模块只保留"从这句话里读出指涉"的语用判断（显式日期 / 序数词 / 指示代词 / 继承）。
// 同时修掉旧实现的静默猜测：**同一天有多条记录不再取最晚一条**，改为列出候选让用户点选
// （旧行为是"另一次你问不到"的根因）。日期工具沿用原实现，经本模块 re-export 保持既有导入不变。

// 日期与"最新记录"工具（实现在 chat-ride-ref，此处 re-export 供既有调用方无感迁移）。
export {
  findRideRecordsByDate,
  latestRideRecord,
  parseRideAnchorDate,
  rideAnchorDate,
  rideAnchorDateLabel,
  type RideAnchorDate,
} from "./chat-ride-ref.ts";

// CHAT-17 P3：autonomous_tools（L2b 循环）同样走锚点解析——挂起轮确认与摘要锚点继承同规则。
export const RIDE_ANCHOR_TOOL_ROUTES: readonly ChatRoute[] = ["current_ride", "capabilities", "history_compare", "autonomous_tools"];

export type RideAnchorOverride = { latest: true } | { date: string } | { rideId: string };

export type RideAnchorResolution =
  | {
    status: "resolved";
    record: RideRecord;
    date?: string;
    source: "override" | "explicit_date" | "explicit_ordinal" | "inherited" | "default_latest";
  }
  | {
    status: "clarify";
    reply: string;
    // AGT-H1：需要用户再指一次时，区分"同一天多条 / 日期没找到 / 根本没有指涉"，
    // 并带上候选（H2 把它转成响应 choices；H1 只用确定性话术，零模型）。
    reason?: ChatRideRefReason;
    candidates?: ChatRideCandidate[];
  };

// ---- 日期工具（实现已下移到 chat-ride-ref.ts，见顶部 re-export）----

// 显式日期提取：2026年8月15日 / 8月15日 / 8月15号 / 2026-08-15。
// 不支持裸 “08-15”（与编号、时刻等歧义）；到达本层的问题已被路由到工具场景，日期即锚点指涉。
const EXPLICIT_DATE_FULL = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/;
const EXPLICIT_DATE_MD = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/;
const EXPLICIT_DATE_ISO = /(\d{4})-(\d{1,2})-(\d{1,2})/;

export function extractExplicitRideDate(text: string): RideAnchorDate | undefined {
  const candidates: RideAnchorDate[] = [];
  const full = EXPLICIT_DATE_FULL.exec(text);
  if (full) candidates.push({ year: Number(full[1]), month: Number(full[2]), day: Number(full[3]) });
  const iso = EXPLICIT_DATE_ISO.exec(text);
  if (iso) candidates.push({ year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) });
  const md = EXPLICIT_DATE_MD.exec(text);
  if (md) candidates.push({ month: Number(md[1]), day: Number(md[2]) });
  return candidates.find((candidate) => candidate.month >= 1 && candidate.month <= 12 && candidate.day >= 1 && candidate.day <= 31);
}

// 按日期查找**单条**记录（兼容保留）：同一天多条时取出发时间最晚的一条。
// AGT-H1 起，锚点解析路径**不再使用它**（改用 findRideRecordsByDate 判多条），
// 只有"日期粒度足够"的场景（骑行身份问答）仍用它。
export function findRideRecordByDate(entries: ReadonlyArray<{ record: RideRecord }>, target: RideAnchorDate, now = new Date()): RideRecord | undefined {
  return findRideRecordsByDate(entries, target, now)[0];
}

/**
 * AGT-H1：日期 → 记录，**多条不再静默取最晚**。
 * 返回 resolved（唯一）/ clarify（同日多条，列候选）/ clarify（没有该日记录）。
 */
function resolveByDate(
  entries: ReadonlyArray<{ record: RideRecord }>,
  target: RideAnchorDate,
  options: { dateLabel: string; now?: Date },
): RideAnchorResolution {
  const matches = findRideRecordsByDate(entries, target, options.now);
  if (matches.length === 0) {
    return {
      status: "clarify",
      reason: "date_not_found",
      candidates: chatRideCandidates(entries),
      reply: chatRideRefReply(
        { status: "not_found", reason: "date_not_found", candidates: chatRideCandidates(entries) },
        { dateLabel: options.dateLabel },
      ),
    };
  }
  const record = matches[0]!;
  // 同日多条：两条都摆出来，让用户点选（旧实现在这里偷偷选了出发较晚的那条）。
  if (matches.length > 1) {
    const candidates = matches.map((match) => chatRideCandidates([{ record: match }], 1)[0]!);
    return {
      status: "clarify",
      reason: "same_day_multiple",
      candidates,
      reply: `${options.dateLabel}有 ${matches.length} 条骑行记录：${candidates.map((candidate) => chatRideCandidateLabel(candidate)).join("；")}。你想看哪一条？`,
    };
  }
  return { status: "resolved", record, ...(rideAnchorDate(record.activity.startTime) ? { date: rideAnchorDate(record.activity.startTime) } : {}), source: "explicit_date" };
}

// 上下文继承：从最近一轮摘要向前找已建立的锚点日期（锚点跨轮持续，直到被新锚点替换）。
export function lastSummarizedAnchor(summaries: readonly ChatSessionSummary[]): string | undefined {
  if (summaries.at(-1)?.route === "level_assessment") return undefined;
  for (let index = summaries.length - 1; index >= 0; index -= 1) {
    if (summaries[index]?.rideScope || summaries[index]?.route === "level_assessment") return undefined;
    const anchor = summaries[index]?.rideAnchor;
    if (anchor) return anchor;
  }
  return undefined;
}

// ---- 锚点解析 ----

// 显式序数：直接锚定最新记录，不澄清。“上次”在比较问法中是基线指涉（“比上次快吗”），
// 因此 history_compare 场景不把裸“上次”当锚点主体（比较主体是“这次”，走指涉链路）。
const ORDINAL_STRICT = /(最近一次|上一次|最新一次|最新一条|刚才)/;
const ORDINAL_WITH_LAST = /(最近一次|上一次|最新一次|最新一条|刚才|上次)/;
// 指示性指涉：不默认等于最新记录——继承前轮锚点，无锚点触发确定性确认话术（零模型调用）。
const DEIXIS_PATTERN = /(本次|这次|当前|刚刚)/;

function latestClarifyReply(deixisWord: string | undefined, latest: RideRecord | undefined): string {
  const label = latest ? rideAnchorDate(latest.activity.startTime) : undefined;
  if (!label) return "你想问的是最近一条骑行记录，还是其他某一次？可以直接告诉我日期。";
  const subject = deixisWord ? `你说的「${deixisWord}」` : "你想问的这次数据";
  return `${subject}是指最近一次（${rideAnchorDateLabel(label)}）的骑行，还是其他某一次？可以直接告诉我日期。`;
}

export function resolveRideAnchor(input: {
  text: string;
  route: ChatRoute;
  summaries: readonly ChatSessionSummary[];
  entries: ReadonlyArray<{ record: RideRecord }>;
  override?: RideAnchorOverride;
  now?: Date;
}): RideAnchorResolution {
  const { text, route, summaries, entries } = input;
  const latest = latestRideRecord(entries);
  if (!latest) return { status: "clarify", reply: "还没有可供查看的骑行记录。导入一条自己的骑行记录后再试。" };

  // 确认轮覆写（route.ts 解析挂起问题后传入）：不再走文本解析。
  if (input.override) {
    if ("rideId" in input.override) {
      const id = input.override.rideId;
      const record = entries.find(entry => entry.record.activity.rideId === id)?.record;
      return record ? { status: "resolved", record, date: rideAnchorDate(record.activity.startTime), source: "override" } : { status: "clarify", reply: "所选骑行已不可用，请重新选择记录。" };
    }
    if ("latest" in input.override) {
      return { status: "resolved", record: latest, ...(rideAnchorDate(latest.activity.startTime) ? { date: rideAnchorDate(latest.activity.startTime) } : {}), source: "override" };
    }
    const target = parseRideAnchorDate(input.override.date);
    if (!target) {
      return { status: "clarify", reason: "date_not_found", reply: `没有找到 ${rideAnchorDateLabel(input.override.date)} 的骑行记录。可以换个日期，或直接问我最近一次。` };
    }
    // AGT-H1：确认轮给的日期同样要判多条——同一天两条时不能替用户选（原实现取最晚）。
    const byDate = resolveByDate(entries, target, { dateLabel: rideAnchorDateLabel(input.override.date), ...(input.now ? { now: input.now } : {}) });
    if (byDate.status !== "resolved") return byDate;
    return { ...byDate, date: input.override.date, source: "override" };
  }

  const ordinalMatch = /倒数第?([0-9]+|[一二两三四五六七八九十]+)次/.exec(text);
  if (ordinalMatch) {
    const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    const n = /^\d+$/.test(ordinalMatch[1]) ? Number(ordinalMatch[1]) : digits[ordinalMatch[1]];
    const record = n ? rideRecordByOrdinal(entries, -n) : undefined;
    return record ? { status: "resolved", record, date: rideAnchorDate(record.activity.startTime), source: "explicit_ordinal" }
      : { status: "clarify", reason: "ordinal_out_of_range", candidates: chatRideCandidates(entries), reply: "没有找到你指定序号的骑行，请从记录中选择。" };
  }

  // ① 显式日期：本人记录查找；**同日多条 → 列候选**（AGT-H1 修掉的静默猜测）。
  const explicit = extractExplicitRideDate(text);
  if (explicit) {
    const label = `${explicit.year ? `${explicit.year}年` : ""}${explicit.month}月${explicit.day}日`;
    return resolveByDate(entries, explicit, { dateLabel: label, ...(input.now ? { now: input.now } : {}) });
  }

  const inheritAnchor = (): RideAnchorResolution => {
    const selected = lastChatRideChoice(summaries);
    if (selected?.kind === "ride") {
      const record = entries.find(entry => entry.record.activity.rideId === selected.id)?.record;
      return record ? { status: "resolved", record, date: rideAnchorDate(record.activity.startTime), source: "inherited" } : { status: "clarify", reply: "所选骑行已不可用，请重新选择记录。" };
    }
    const anchorDate = lastSummarizedAnchor(summaries);
    if (!anchorDate) {
      return { status: "clarify", reason: "reference_missing", candidates: chatRideCandidates(entries), reply: latestClarifyReply(DEIXIS_PATTERN.exec(text)?.[0], latest) };
    }
    const target = parseRideAnchorDate(anchorDate);
    if (!target) {
      return { status: "clarify", reason: "date_not_found", reply: `之前提到的 ${rideAnchorDateLabel(anchorDate)} 那次骑行的记录已经不在了。可以告诉我其他日期，或问我最近一次。` };
    }
    const byDate = resolveByDate(entries, target, { dateLabel: rideAnchorDateLabel(anchorDate), ...(input.now ? { now: input.now } : {}) });
    // 继承路径的"记录已不在"要说明是**之前提到的**那次——沿用旧话术骨架，避免用户以为是新问题。
    if (byDate.status === "clarify" && byDate.reason === "date_not_found") {
      return { ...byDate, reply: `之前提到的 ${rideAnchorDateLabel(anchorDate)} 那次骑行的记录已经不在了。可以告诉我其他日期，或问我最近一次。` };
    }
    if (byDate.status !== "resolved") return byDate;
    // 继承路径保留"锚点是一整段上下文"的语义：日期命中唯一记录时沿用摘要里的日期串。
    return { ...byDate, date: anchorDate, source: "inherited" };
  };

  if (route === "history_compare") {
    // 比较问法：比较主体是“这次”（指涉 → 继承/澄清）；“最近一次”等序数作主体时锚定最新；
    // 无任何指涉（“有进步吗”）默认最新——比较语义的主体即当前（最近一次）骑行。
    if (DEIXIS_PATTERN.test(text)) return inheritAnchor();
    if (ORDINAL_STRICT.test(text)) {
      return { status: "resolved", record: latest, ...(rideAnchorDate(latest.activity.startTime) ? { date: rideAnchorDate(latest.activity.startTime) } : {}), source: "explicit_ordinal" };
    }
    return { status: "resolved", record: latest, ...(rideAnchorDate(latest.activity.startTime) ? { date: rideAnchorDate(latest.activity.startTime) } : {}), source: "default_latest" };
  }

  // current_ride / capabilities：序数（含裸“上次”，如“上次骑了多远”）→ 最新；
  // 指涉词 → 继承/澄清；capabilities 默认最新不澄清——能力清单对记录不敏感，
  // “当前/这次可以分析哪些数据”问的是能力范围而非某次骑行，不该触发锚点澄清；
  // 而 current_ride 到达本层必含指标词（裸指标 = 指示性指涉）。
  if (ORDINAL_WITH_LAST.test(text)) {
    return { status: "resolved", record: latest, ...(rideAnchorDate(latest.activity.startTime) ? { date: rideAnchorDate(latest.activity.startTime) } : {}), source: "explicit_ordinal" };
  }
  if (route === "capabilities") {
    // 已有锚点时沿用（保持会话上下文一致），无锚点则按最新记录回答，不澄清。
    if (lastSummarizedAnchor(summaries)) return inheritAnchor();
    return { status: "resolved", record: latest, ...(rideAnchorDate(latest.activity.startTime) ? { date: rideAnchorDate(latest.activity.startTime) } : {}), source: "default_latest" };
  }
  if (DEIXIS_PATTERN.test(text) || route === "current_ride") return inheritAnchor();
  return { status: "resolved", record: latest, ...(rideAnchorDate(latest.activity.startTime) ? { date: rideAnchorDate(latest.activity.startTime) } : {}), source: "default_latest" };
}

// ---- 锚点确认轮（挂起问题完成）----

// 纯确认语：本身不构成完整新问题；仅当摘要挂起轮（工具路由且无锚点，即上一轮触发了锚点澄清）
// 存在时，作为对该轮确认话术的回答处理。
const CONFIRMATION_YES = /^(是|是的|对|对的|没错|嗯|嗯嗯|好|好的|ok)$/i;
const CONFIRMATION_LATEST = /^(最近一次|最新一次|上一次|最新一条|上次|刚刚那次)$/;
// CHAT-17 P3：autonomous_tools 加入确认路由集——纯确认语经分类器可能映射 L2b（open_chat），
// 挂起的自主循环轮同样可被“最近一次/是的/日期”完成。
const CONFIRMATION_ROUTES = new Set<string>(["current_ride", "capabilities", "history_compare", "autonomous_tools", "out_of_scope", "clarification"]);

export type AnchorConfirmationPending =
  | { type: "latest"; question: string; route: ChatRoute }
  | { type: "date"; question: string; route: ChatRoute; date: RideAnchorDate };

export function detectAnchorConfirmation(input: {
  text: string;
  decision: ChatRoutingDecision;
  summaries: readonly ChatSessionSummary[];
}): AnchorConfirmationPending | null {
  const pending = input.summaries[input.summaries.length - 1];
  if (!pending || pending.rideAnchor !== undefined || pending.choice !== undefined || (pending.rideScope !== undefined && pending.rideScope !== "pending")) return null;
  if (!RIDE_ANCHOR_TOOL_ROUTES.includes(pending.route)) return null;
  if (!CONFIRMATION_ROUTES.has(input.decision.route)) return null;
  const compact = input.text.trim().replaceAll(/\s/g, "");
  if (CONFIRMATION_YES.test(compact) || CONFIRMATION_LATEST.test(compact)) {
    return { type: "latest", question: pending.question, route: pending.route };
  }
  const date = extractExplicitRideDate(compact);
  if (date) return { type: "date", question: pending.question, route: pending.route, date };
  return null;
}

// 确认轮落地：latest → 最新记录；日期 → 本人记录查找（无匹配确定性回复，零模型调用）。
// 完成后以挂起原问题作为本轮有效问题重新进入编排（锚点覆写传入，避免再次澄清）。
export function resolveAnchorConfirmation(input: {
  confirmation: AnchorConfirmationPending;
  entries: ReadonlyArray<{ record: RideRecord }>;
  now?: Date;
}):
  | { kind: "complete"; text: string; decision: ChatRoutingDecision; anchor: RideAnchorOverride }
  | { kind: "reply"; reply: string } {
  const { confirmation } = input;
  if (confirmation.type === "latest") {
    return { kind: "complete", text: confirmation.question, decision: classifyChatInput(confirmation.question), anchor: { latest: true } };
  }
  const label = `${confirmation.date.year ? `${confirmation.date.year}年` : ""}${confirmation.date.month}月${confirmation.date.day}日`;
  // AGT-H1：确认轮给的日期要判"同日多条"——同一天两条时不能替用户选最晚那条，
  // 直接按候选列表确定性回复（零模型），让用户说出时间或（H3 起）点选。
  const matches = findRideRecordsByDate(input.entries, confirmation.date, input.now);
  if (matches.length === 0) {
    return { kind: "reply", reply: `没有找到 ${label} 的骑行记录。可以换个日期，或直接问我最近一次。` };
  }
  if (matches.length > 1) {
    const candidates = matches.map((match) => chatRideCandidates([{ record: match }], 1)[0]!);
    return { kind: "reply", reply: `${label}有 ${matches.length} 条骑行记录：${candidates.map((candidate) => chatRideCandidateLabel(candidate)).join("；")}。你想看哪一条？` };
  }
  const record = matches[0]!;
  const date = rideAnchorDate(record.activity.startTime);
  if (!date) return { kind: "reply", reply: "这条骑行记录缺少有效日期，暂时无法定位。可以直接问我最近一次。" };
  return { kind: "complete", text: confirmation.question, decision: classifyChatInput(confirmation.question), anchor: { date } };
}

// RIDE_IDENTITY（“当次是哪一次”）按锚点应答；无锚点时披露“按最近一次处理”。
export function rideIdentityReply(summaries: readonly ChatSessionSummary[], entries: ReadonlyArray<{ record: RideRecord }>): string {
  const selected = lastChatRideChoice(summaries);
  if (selected) {
    const record = entries.find(entry => entry.record.activity.rideId === selected.id)?.record;
    if (!record) return "所选骑行已不可用，请重新选择记录。";
    const date = rideAnchorDate(record.activity.startTime);
    const time = date ? new Date(record.activity.startTime!).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }) : undefined;
    return date ? `当前对话选择的是 ${rideAnchorDateLabel(date)} ${time} 出发的骑行。` : "当前对话使用你已选择的记录；该记录没有有效出发日期。";
  }
  if (!lastSummarizedAnchor(summaries) && summaries.some(summary => summary.rideScope || summary.route === "level_assessment")) return "当前没有选定单次骑行；可以从记录中选择要分析的那一次。";
  const anchorDate = lastSummarizedAnchor(summaries);
  if (anchorDate) {
    const target = parseRideAnchorDate(anchorDate);
    if (target && findRideRecordByDate(entries, target)) {
      return `当前对话按 ${rideAnchorDateLabel(anchorDate)} 这次骑行处理；如指其他某一次，可以直接告诉我日期。`;
    }
  }
  const latest = latestRideRecord(entries);
  const label = latest ? rideAnchorDate(latest.activity.startTime) : undefined;
  return label
    ? `当前按最近一次（${rideAnchorDateLabel(label)}）的骑行处理；如指其他某一次，可以直接告诉我日期。`
    : "还没有带有效日期的骑行记录。";
}
