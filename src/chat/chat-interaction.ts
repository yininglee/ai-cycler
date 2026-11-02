import { createUserProfile, type ProfileInput } from "../domain/user-profile.ts";
import { isUserGoalDraft, type UserGoalDraft } from "../domain/user-goal.ts";
// AGT-H0（批次 1 · 交互骨架）：交互平面合同 v0.3 —— **类型与校验层的唯一事实源**。
//
// 这里定稿三件事，其余层只引用、不重定义：
//   ① 响应结构化载荷（`choices` / `artifact` / `quickActions`）的形状与上限；
//   ② 摘要槽位 v0.3 的 `choice {kind, id}` 形状（跨轮选择记忆）；
//   ③ 非法数据的处置策略——**字段级整体丢弃，绝不部分渲染**。
//
// ## 与模型输出协议的关系（重要，别搞混）
//
// 模型输出使用 `ride-chat-output-v0.3`（兼容旧 v0.1/v0.2），新增 responseKind
// 区分回答与澄清；`choices` / `artifact` / `quickActions` **全部由编排层
// 从工具结果同源生成，模型不经手**——所以这里不升模型合同版本，也不会给模型伪造
// 记录列表的机会（伪造的 rideId 不是本人记录，在 H3 的归属校验与这里的结构校验
// 两处都会被挡）。
//
// 版本号 `ride-chat-interaction-v0.3` 对应需求文档里的"输出合同 v0.3"，指的是
// **响应层**合同；旧前端忽略这些字段即可（全部 optional），故不需要前端同步升级。
//
// ## 为什么"整体丢弃"而不是"跳过非法项"
//
// 记录列表是**可点选**的：少一条会让人以为剩下就是全部，点错一条会分析错记录。
// 因此 `choices` 只要有一条结构非法，整个字段丢弃（前端退回纯文本追问，用户重述一次
// 即可恢复）；`artifact` 同理。重复项（同 kind + id）只是冗余、不误导，做去重而非丢弃。

export const CHAT_INTERACTION_CONTRACT_VERSION = "ride-chat-interaction-v0.3" as const;

// 合同上限（服务端保证不超；渲染层可再收窄——D-H1 建议展示 5 条 + 超出折叠）。
export const CHAT_CHOICE_MAX_ITEMS = 8;
export const CHAT_QUICK_ACTION_MAX_ITEMS = 4;
export const CHAT_CHOICE_ID_MAX_CHARS = 128;
export const CHAT_CHOICE_LABEL_MAX_CHARS = 40;
export const CHAT_CHOICE_SUBLABEL_MAX_CHARS = 60;
export const CHAT_RIDE_LIST_MAX_ITEMS = 20;
export const CHAT_GOAL_OPTION_MAX_ITEMS = 8;
export const CHAT_ARTIFACT_PAYLOAD_MAX_BYTES = 8 * 1_024;

// ---------------------------------------------------------------------------
// choices：渲染用的扁平可点列表
// ---------------------------------------------------------------------------

export type ChatChoiceKind = "ride" | "goal" | "plan_slot";

export const CHAT_CHOICE_KINDS: readonly ChatChoiceKind[] = ["ride", "goal", "plan_slot"];

const CHAT_CHOICE_KIND_SET = new Set<string>(CHAT_CHOICE_KINDS);

export type ChatChoice = {
  kind: ChatChoiceKind;
  // `kind="ride"` 时必须是 **rideId**（同日多条只能靠它区分，传日期不算）——见 AGT-H3。
  id: string;
  label: string;
  sublabel?: string;
};

/** 摘要槽位里存的极简选择记忆（不带文案——文案随记录变化，不是事实）。 */
export type ChatChoiceRef = {
  kind: ChatChoiceKind;
  id: string;
};

// ---------------------------------------------------------------------------
// artifact：结构化交付物（与 choices 同源，不双写）
// ---------------------------------------------------------------------------

export type ChatRideListItem = {
  title?: string;
  rideId: string;
  dateLabel: string;
  distanceKm?: number;
  durationLabel?: string;
  hasPower?: boolean;
  hasHeartRate?: boolean;
};

export type ChatRideListArtifact = {
  kind: "ride_list";
  payload: {
    items: ChatRideListItem[];
    /** 候选总数（含被截断的部分）——前端据此显示"还有 N 条"。 */
    totalCount: number;
    truncated: boolean;
  };
};

export type ChatGoalOption = { id: string; label: string };

export type ChatGoalOptionsArtifact = {
  kind: "goal_options";
  payload: { options: ChatGoalOption[] };
};

// AGT-F 定稿计划实体后收紧；H0 只锁"必须是对象 + 体积上限"，不提前冻结 F 的合同。
export type ChatPlanArtifact = {
  kind: "plan";
  payload: Record<string, unknown>;
};

export type ChatProfileProposalArtifact = { kind: "profile_proposal"; payload: { input: ProfileInput; previous: ProfileInput } };
export type ChatOnboardingArtifact = { kind: "onboarding"; payload: { goalDraft: string } };
export type ChatGoalEditorArtifact = { kind: "goal_editor"; payload: { draft: UserGoalDraft | null } };
export type ChatRideImportArtifact = { kind: "ride_import"; payload: Record<string, never> };
export type ChatArtifact = ChatRideListArtifact | ChatGoalOptionsArtifact | ChatPlanArtifact | ChatProfileProposalArtifact | ChatOnboardingArtifact | ChatGoalEditorArtifact | ChatRideImportArtifact;

export type ChatArtifactKind = ChatArtifact["kind"];

export const CHAT_ARTIFACT_KINDS: readonly ChatArtifactKind[] = ["ride_list", "plan", "goal_options", "profile_proposal", "onboarding", "goal_editor", "ride_import"];

// ---------------------------------------------------------------------------
// quickActions：可执行动作（按钮）
// ---------------------------------------------------------------------------

// 目前只有深度分析入口；计划生效确认（F）会新增取值，届时扩表并补正反例。
export type ChatQuickActionKind = "deepAnalysis";

export const CHAT_QUICK_ACTION_KINDS: readonly ChatQuickActionKind[] = ["deepAnalysis"];

export type ChatQuickAction = {
  kind: ChatQuickActionKind;
  // 深度分析靠 rideId 打开抽屉（复用骑后解读链路），不靠日期——同日多条必须可区分。
  rideId: string;
  dateLabel: string;
};

// ---------------------------------------------------------------------------
// 通用校验工具
// ---------------------------------------------------------------------------

export type ChatSanitized<T> = {
  value?: T;
  /** true = 提供了该字段但结构非法（调用方应记观测并从响应里剔除）。 */
  dropped: boolean;
};

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
// rideId 实际形态：`upload-<uuid>` / `private-ride-0` / `r-0820` / `demo-*`——统一按
// "不含空白与控制字符的标识符"校验，不做前缀白名单（前缀是实现的偶然，不是合同）。
const CHAT_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => key in value)
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && CHAT_ID_PATTERN.test(value);
}

function isText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !CONTROL_CHARACTERS.test(value);
}

function isOptional<T>(value: unknown, predicate: (item: unknown) => boolean): boolean {
  return value === undefined || predicate(value);
}

function chatChoiceDedupeKey(choice: { kind: string; id: string }): string {
  return `${choice.kind}:${choice.id}`;
}

export function isChatChoiceKind(value: unknown): value is ChatChoiceKind {
  return typeof value === "string" && CHAT_CHOICE_KIND_SET.has(value);
}

/** 摘要槽位用的 choice 引用（只认 kind + id，多一个键就算非法）。 */
export function isChatChoiceRef(value: unknown): value is ChatChoiceRef {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, ["kind", "id"])) return false;
  return isChatChoiceKind(value.kind) && isIdentifier(value.id);
}

function isChatChoice(value: unknown): value is ChatChoice {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, ["kind", "id", "label"], ["sublabel"])) return false;
  if (!isChatChoiceKind(value.kind) || !isIdentifier(value.id)) return false;
  if (!isText(value.label, CHAT_CHOICE_LABEL_MAX_CHARS)) return false;
  return isOptional(value.sublabel, (item) => isText(item, CHAT_CHOICE_SUBLABEL_MAX_CHARS));
}

/**
 * `choices` 净化：结构非法或超上限 → 整个字段丢弃；重复项（同 kind+id）保留首次出现。
 * 未提供（undefined）与空数组都合法——前者表示"本轮没有选项"，后者表示"选项为空"。
 */
export function sanitizeChatChoices(input: unknown): ChatSanitized<ChatChoice[]> {
  if (input === undefined) return { dropped: false };
  if (!Array.isArray(input)) return { dropped: true };
  if (input.length === 0) return { value: [], dropped: false };
  // 超上限按非法处理（而不是悄悄截断）：截断后的列表看起来"就是全部"，
  // 与少一条同样误导。编排层要用到更多候选时，应自己先截断并配 artifact.totalCount。
  if (input.length > CHAT_CHOICE_MAX_ITEMS) return { dropped: true };
  const seen = new Set<string>();
  const choices: ChatChoice[] = [];
  for (const item of input) {
    if (!isChatChoice(item)) return { dropped: true };
    const key = chatChoiceDedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({ kind: item.kind, id: item.id, label: item.label, ...(item.sublabel !== undefined ? { sublabel: item.sublabel } : {}) });
  }
  return { value: choices, dropped: false };
}

function isRideListItem(value: unknown): value is ChatRideListItem {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, ["rideId", "dateLabel"], ["title", "distanceKm", "durationLabel", "hasPower", "hasHeartRate"])) return false;
  if (!isOptional(value.title, item => isText(item, CHAT_CHOICE_LABEL_MAX_CHARS))) return false;
  if (!isIdentifier(value.rideId) || !isText(value.dateLabel, CHAT_CHOICE_LABEL_MAX_CHARS)) return false;
  if (!isOptional(value.distanceKm, (item) => typeof item === "number" && Number.isFinite(item) && item >= 0)) return false;
  if (!isOptional(value.durationLabel, (item) => isText(item, CHAT_CHOICE_LABEL_MAX_CHARS))) return false;
  return isOptional(value.hasPower, (item) => typeof item === "boolean")
    && isOptional(value.hasHeartRate, (item) => typeof item === "boolean");
}

function sanitizeRideListPayload(payload: Record<string, unknown>): ChatArtifact | undefined {
  if (!Array.isArray(payload.items) || payload.items.length === 0) return undefined;
  if (payload.items.length > CHAT_RIDE_LIST_MAX_ITEMS) return undefined;
  const seen = new Set<string>();
  const items: ChatRideListItem[] = [];
  for (const item of payload.items) {
    if (!isRideListItem(item)) return undefined;
    if (seen.has(item.rideId)) continue;
    seen.add(item.rideId);
    items.push(item);
  }
  // totalCount / truncated 可省略：缺省按"没有截断"归一（列表完整时前端不必额外判断）。
  const totalCandidate = payload.totalCount ?? items.length;
  if (typeof totalCandidate !== "number" || !Number.isInteger(totalCandidate) || totalCandidate < items.length) return undefined;
  const truncatedCandidate = payload.truncated ?? totalCandidate > items.length;
  if (typeof truncatedCandidate !== "boolean") return undefined;
  if (truncatedCandidate !== totalCandidate > items.length) return undefined;
  return { kind: "ride_list", payload: { items, totalCount: totalCandidate, truncated: truncatedCandidate } };
}

function sanitizeGoalOptionsPayload(payload: Record<string, unknown>): ChatArtifact | undefined {
  if (!Array.isArray(payload.options) || payload.options.length === 0) return undefined;
  if (payload.options.length > CHAT_GOAL_OPTION_MAX_ITEMS) return undefined;
  const seen = new Set<string>();
  const options: ChatGoalOption[] = [];
  for (const option of payload.options) {
    if (!isRecord(option) || !hasExactKeys(option, ["id", "label"])) return undefined;
    if (!isIdentifier(option.id) || !isText(option.label, CHAT_CHOICE_LABEL_MAX_CHARS)) return undefined;
    if (seen.has(option.id)) continue;
    seen.add(option.id);
    options.push({ id: option.id, label: option.label });
  }
  return { kind: "goal_options", payload: { options } };
}

/**
 * `artifact` 净化：kind 枚举、payload 形状、体积上限任一不合格 → 整个字段丢弃。
 * `plan` 的 payload 形状归 AGT-F（此处只保证是对象且不超体积），不提前冻结。
 */
export function sanitizeChatArtifact(input: unknown): ChatSanitized<ChatArtifact> {
  if (input === undefined) return { dropped: false };
  if (!isRecord(input)) return { dropped: true };
  if (!hasExactKeys(input, ["kind", "payload"])) return { dropped: true };
  if (!isRecord(input.payload)) return { dropped: true };
  if (new TextEncoder().encode(JSON.stringify(input.payload)).byteLength > CHAT_ARTIFACT_PAYLOAD_MAX_BYTES) return { dropped: true };
  switch (input.kind) {
    case "ride_import":
      return hasExactKeys(input.payload, []) ? { value: { kind: "ride_import", payload: {} }, dropped: false } : { dropped: true };
    case "goal_editor":
      return hasExactKeys(input.payload, ["draft"]) && (input.payload.draft === null || isUserGoalDraft(input.payload.draft))
        ? { value: { kind: "goal_editor", payload: { draft: input.payload.draft } }, dropped: false } : { dropped: true };
    case "profile_proposal": {
      const payload = input.payload;
      const validProfileInput = (value: unknown): value is ProfileInput => {
        if (!isRecord(value) || !Object.keys(value).length || !Object.keys(value).every(key => ["age", "heightCm", "weightKg", "maxHeartRateBpm", "ftpWatts"].includes(key))) return false;
        if (!Object.values(value).every(v => v === null || (typeof v === "number" && Number.isFinite(v)))) return false;
        try { createUserProfile(value); return true; } catch { return false; }
      };
      if (!hasExactKeys(payload, ["input", "previous"]) || !validProfileInput(payload.input) || !isRecord(payload.previous) || (Object.keys(payload.previous).length && !validProfileInput(payload.previous))) return { dropped: true };
      return { value: { kind: "profile_proposal", payload: { input: payload.input, previous: payload.previous } }, dropped: false };
    }
    case "onboarding":
      return hasExactKeys(input.payload, ["goalDraft"]) && typeof input.payload.goalDraft === "string" && input.payload.goalDraft.length <= 400 && !CONTROL_CHARACTERS.test(input.payload.goalDraft)
        ? { value: { kind: "onboarding", payload: { goalDraft: input.payload.goalDraft } }, dropped: false } : { dropped: true };

    case "ride_list": {
      const artifact = sanitizeRideListPayload(input.payload);
      return artifact ? { value: artifact, dropped: false } : { dropped: true };
    }
    case "goal_options": {
      const artifact = sanitizeGoalOptionsPayload(input.payload);
      return artifact ? { value: artifact, dropped: false } : { dropped: true };
    }
    case "plan":
      return { value: { kind: "plan", payload: input.payload }, dropped: false };
    default:
      return { dropped: true };
  }
}

function isChatQuickAction(value: unknown): value is ChatQuickAction {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, ["kind", "rideId", "dateLabel"])) return false;
  return value.kind === "deepAnalysis"
    && isIdentifier(value.rideId)
    && isText(value.dateLabel, CHAT_CHOICE_LABEL_MAX_CHARS);
}

/** `quickActions` 净化：任一非法 → 整个字段丢弃；同 rideId 的动作去重。 */
export function sanitizeChatQuickActions(input: unknown): ChatSanitized<ChatQuickAction[]> {
  if (input === undefined) return { dropped: false };
  if (!Array.isArray(input)) return { dropped: true };
  if (input.length === 0) return { value: [], dropped: false };
  if (input.length > CHAT_QUICK_ACTION_MAX_ITEMS) return { dropped: true };
  const seen = new Set<string>();
  const actions: ChatQuickAction[] = [];
  for (const item of input) {
    if (!isChatQuickAction(item)) return { dropped: true };
    if (seen.has(item.rideId)) continue;
    seen.add(item.rideId);
    actions.push({ kind: item.kind, rideId: item.rideId, dateLabel: item.dateLabel });
  }
  return { value: actions, dropped: false };
}

/**
 * 一次净化三件套——编排层在返回响应前调用，避免各处重复拼装。
 * 返回的字段只在有值时出现（未提供就不出现在响应里，保持旧响应形状零变化）。
 */
export function sanitizeChatInteractionPayload(input: {
  choices?: unknown;
  artifact?: unknown;
  quickActions?: unknown;
}): { choices?: ChatChoice[]; artifact?: ChatArtifact; quickActions?: ChatQuickAction[]; droppedFields: Array<"choices" | "artifact" | "quickActions"> } {
  const choices = sanitizeChatChoices(input.choices);
  const artifact = sanitizeChatArtifact(input.artifact);
  const quickActions = sanitizeChatQuickActions(input.quickActions);
  // A supplied ride-list is the reference set for buttons/choices in this envelope.
  // Do not render an independently well-shaped action for a different record.
  if (input.artifact !== undefined && (artifact.dropped || artifact.value?.kind === "ride_list")) {
    const ids = new Set(artifact.value?.kind === "ride_list" ? artifact.value.payload.items.map(item => item.rideId) : []);
    if (choices.value?.some(choice => choice.kind === "ride" && !ids.has(choice.id))) { choices.value = undefined; choices.dropped = true; }
    if (quickActions.value?.some(action => !ids.has(action.rideId))) { quickActions.value = undefined; quickActions.dropped = true; }
  }
  const droppedFields: Array<"choices" | "artifact" | "quickActions"> = [];
  if (choices.dropped) droppedFields.push("choices");
  if (artifact.dropped) droppedFields.push("artifact");
  if (quickActions.dropped) droppedFields.push("quickActions");
  return {
    ...(choices.value !== undefined ? { choices: choices.value } : {}),
    ...(artifact.value !== undefined ? { artifact: artifact.value } : {}),
    ...(quickActions.value !== undefined ? { quickActions: quickActions.value } : {}),
    droppedFields,
  };
}

export type ChatAgentInteraction = { choices?: ChatChoice[]; artifact?: ChatArtifact; quickActions?: ChatQuickAction[] };
