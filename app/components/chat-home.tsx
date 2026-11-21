"use client";
import { StatusBadge } from "./status-badge";
import { isChatRideScope, type ChatRideScope } from "../../src/chat/chat-context.ts";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment, type FormEvent, type MouseEvent } from "react";

import type { ChatHomeSnapshot } from "../../src/chat/chat-home.ts";
import { CHAT_IMPORT_QUEUE_KEY, parseImportReceipts, restoreImportReceipts } from "../../src/chat/chat-import";
import { ChatRideList } from "./chat-ride-list";
import { sanitizeChatInteractionPayload, isChatChoiceRef, type ChatChoiceRef, type ChatAgentInteraction } from "../../src/chat/chat-interaction";
import { RideSyncLauncher } from "./ride-sync";
import { TrainingPlanBar, TrainingPlanCard, notifyPlanUpdated, planRequest, planDetailHref, useTrainingPlanView } from "./training-plan";
import { planToday } from "../../src/domain/training-plan";
import { TrainingExecutionCard, TrainingExecutionReply } from "./training-execution";
import { parsePlanDiscussion, planDiscussionKey, planDiscussionText } from "../../src/training/plan-discussion";
import { SideDrawer } from "./side-drawer";
import { ChatReplyText } from "./chat-reply-text";
import { Onboarding, PrototypeSettings } from "./ux-onboarding";
import { PROFILE_LABELS } from "../../src/chat/profile-proposal";
import type { ProfileInput } from "../../src/domain/user-profile";
import Link from "next/link";
import { ArrowIcon, BikeIcon, InfoIcon, RefreshIcon } from "./icons";
import {
  appendChatTurn,
  appendImportedRides,
  rememberChatRideSelection,
  refreshChatSnapshot,
  buildChatSessionSummaries,
  buildChatTimeline,
  CHAT_SESSION_IDLE_MS,
  chatHomeSnapshotFingerprint,
  createChatSession,
  getActiveChatConversation,
  isChatSessionStale,
  isChatConversationExpired,
  readStoredChatSession,
  resumeChatSession,
  startChatConversation,
  storeChatSession,
  type ChatSessionSummarySource,
} from "../../src/chat/chat-session.ts";
import { isChatRoute, type ChatSessionSummary } from "../../src/chat/chat-routing.ts";

// CHAT-14 P1：携带当前对话白名单摘要（≤6 条 session_turn 槽位）请求服务端；
// 响应解析 reply / rideAnchor / decision.route 供槽位记录（锚点继承与挂起确认识别依赖）。
// D-A2「诚实失败优于错误猜测」在前端的落地（2026-10-24 回归修复）。
// 旧实现在服务端失败时回退到本地正则模板（replyToChatInput）：问「上次我的骑行心率多少？」
// 被 /(最近|上次).*(骑行|记录)/ 命中，答成"最近一次骑行记录的日期是 10/5"——答非所问。
// 现在任何业务答案必须来自服务端；拿不到就如实说拿不到。
const CHAT_UNAVAILABLE_REPLY = "对话服务暂时不可用；我不会使用未经验证的结果回答。";

async function requestChatReply(text: string, summaries: ChatSessionSummary[], choice?: ChatChoiceRef): Promise<{ reply: string | null; route?: string; rideAnchor?: string; choice?: ChatChoiceRef; rideScope?: ChatRideScope; interaction?: ChatAgentInteraction }> {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, ...(summaries.length ? { summaries } : {}), ...(choice ? { choice } : {}) }),
    });
    if (!response.ok) { const body = await response.json().catch(() => null); return body?.error === "NOT_FOUND" ? { reply: "所选骑行已不可用，请重新选择记录。", route: "clarification", rideScope: "cleared" } : { reply: CHAT_UNAVAILABLE_REPLY }; }
    const payload: unknown = await response.json();
    const record = payload as { reply?: unknown; rideAnchor?: unknown; decision?: { route?: unknown }; choice?: unknown; rideScope?: unknown; artifact?: unknown; choices?: unknown; quickActions?: unknown } | null;
    const reply = record?.reply;
    const rideAnchor = record?.rideAnchor;
    const route = record?.decision?.route;
    const { droppedFields: _dropped, ...interaction } = sanitizeChatInteractionPayload(record ?? {});
    return {
      interaction,
      ...(isChatRideScope(record?.rideScope) ? { rideScope: record.rideScope } : {}),
      ...(isChatChoiceRef(record?.choice) ? { choice: record.choice } : {}),
      reply: typeof reply === "string" && reply.trim() ? reply : CHAT_UNAVAILABLE_REPLY,
      ...(isChatRoute(route) ? { route } : {}),
      ...(typeof rideAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rideAnchor) ? { rideAnchor } : {}),
    };
  } catch {
    return { reply: CHAT_UNAVAILABLE_REPLY };
  }
}

function ChatPendingReply() {
  return <article className="chat-message chat-message-assistant" role="status"><span className="chat-message-label">Cycler</span><p>正在处理你的问题，请稍候…</p></article>;
}

const HISTORY_PAGE_SIZE = 24;
const HISTORY_PULL_DISTANCE = 112;
const HISTORY_PULL_MAX_OFFSET = 36;
const HISTORY_WHEEL_WINDOW_MS = 240;
const HISTORY_TOP_TOLERANCE = 4;
const RETURN_MESSAGE_KEY = "cycler-chat-return-message";
const DRAFT_KEY = "cycler-chat-draft";
const RIDE_RECOMMENDATIONS = [
  ["最近骑行表现怎么样？", "这周骑了多少公里？", "耐力骑行时怎么控制强度？"],
  ["上一次骑行的心率表现怎么样？", "这个月骑了多少公里？", "骑行后怎么安排恢复？"],
  ["我最长的一次骑行是哪次？", "最近两次骑行有什么变化？", "骑行时怎么分配体力？"],
];
const STARTER_RECOMMENDATIONS = [
  ["第一次骑行怎么安排？", "骑行前需要准备什么？", "耐力骑行时怎么控制强度？"],
  ["骑行时怎么分配体力？", "长距离骑行要带什么？", "骑行后怎么安排恢复？"],
  ["怎么选一条适合自己的骑行路线？", "骑行时怎么补水？", "新手怎么逐步增加骑行距离？"],
];

type MessagePosition = { conversationId: string; index: number };

function messageElementId({ conversationId, index }: MessagePosition) {
  return `chat-message:${conversationId}:${index}`;
}

function activeTimelineStart(timeline: ReturnType<typeof buildChatTimeline>, conversationId: string) {
  const index = timeline.findIndex(message => message.conversationId === conversationId);
  return index < 0 ? timeline.length : index;
}

function hasOpenDialog() {
  return Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'))
    .some(dialog => dialog.getClientRects().length > 0);
}

export function ChatHome({ snapshot, hasExistingSession, liveOneLap }: { snapshot: ChatHomeSnapshot; hasExistingSession: boolean; liveOneLap: boolean }) {
  const trainingPlan = useTrainingPlanView();
  const [previousProfile, setPreviousProfile] = useState<ProfileInput>({});
  const [proposal, setProposal] = useState<ProfileInput | null>(null);
  const [proposalMessage, setProposalMessage] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [session, setSession] = useState(() => createChatSession(snapshot));
  const [input, setInput] = useState("");
  const [recommendationIndex, setRecommendationIndex] = useState(0);
  const [revealingConversation, setRevealingConversation] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<{ userText: string } | null>(null);
  const [timelineStart, setTimelineStart] = useState<MessagePosition | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [setupConversation, setSetupConversation] = useState<string | null>(null);
  const restoredSessionRef = useRef(false);
  const inFlight = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const openingRef = useRef<HTMLElement>(null);
  const firstSetupPositioned = useRef(false);
  const prependAnchor = useRef<{ element: HTMLElement; top: number } | null>(null);
  const scrollTarget = useRef<MessagePosition | null>(null);
  const historyPullStart = useRef<{ x: number; y: number } | null>(null);
  const historyWheel = useRef({ distance: 0, time: 0 });
  const followRepliesRef = useRef(true);
  const finishReveal = useCallback(() => setRevealingConversation(null), []);
  const followReply = useCallback(() => {
    const container = messagesRef.current;
    if (container && followRepliesRef.current) container.scrollTop = container.scrollHeight;
  }, []);
  const setHistoryPull = useCallback((distance: number, rebound = false) => {
    const content = timelineRef.current;
    if (!content) return;
    content.toggleAttribute("data-history-rebound", rebound);
    if (distance > 0) {
      const offset = HISTORY_PULL_MAX_OFFSET * distance / (distance + 96);
      content.style.setProperty("--chat-history-pull", `0 ${offset}px`);
    } else {
      content.style.removeProperty("--chat-history-pull");
    }
  }, []);
  const snapshotFingerprint = chatHomeSnapshotFingerprint(snapshot);

  const activeConversation = getActiveChatConversation(session);
  const timeline = useMemo(() => buildChatTimeline(session), [session]);
  const activeStart = activeTimelineStart(timeline, activeConversation.id);
  const startIndex = timelineStart ? timeline.findIndex(message => message.conversationId === timelineStart.conversationId && message.index === timelineStart.index) : -1;
  const firstVisible = startIndex < 0 ? activeStart : startIndex;
  const lastUserMessage = activeConversation.messages.findLastIndex(message => message.role === "user");
  const pending = pendingTurn !== null || revealingConversation !== null;
  const opening = hydrated && lastUserMessage === -1 && !pending;
  const showFirstSetup = opening && activeConversation.id === setupConversation;
  const recommendationGroups = snapshot.totalRideCount > 0 ? RIDE_RECOMMENDATIONS : STARTER_RECOMMENDATIONS;

  useEffect(() => {
    if (restoredSessionRef.current) return;
    restoredSessionRef.current = true;
    const stored = readStoredChatSession();
    const before = stored ?? createChatSession(snapshot);
    let restored = before;
    let reset: string | null = null;
    try {
      const url = new URL(window.location.href);
      const returnTo = url.searchParams.get("conversation");
      reset = sessionStorage.getItem("cycler-reset-chat");
      sessionStorage.removeItem("cycler-reset-chat");
      const receipts = parseImportReceipts(JSON.parse(sessionStorage.getItem(CHAT_IMPORT_QUEUE_KEY) ?? "[]"), before.activeConversationId);
      restored = restoreImportReceipts(before, receipts);
      restored = reset ? startChatConversation(restored, snapshot) : resumeChatSession(restored, snapshot);
      if (storeChatSession(restored)) sessionStorage.removeItem(CHAT_IMPORT_QUEUE_KEY);

      const sameConversation = before.activeConversationId === restored.activeConversationId;
      if (!reset && returnTo && returnTo !== restored.activeConversationId && url.searchParams.get("discussPlan") === "1"
        && restored.conversations.some(conversation => conversation.id === returnTo)) {
        const key = planDiscussionKey(returnTo);
        const discussion = sessionStorage.getItem(key);
        if (discussion) {
          sessionStorage.setItem(planDiscussionKey(restored.activeConversationId), discussion);
          sessionStorage.removeItem(key);
        }
      }
      if (!sameConversation) sessionStorage.removeItem(planDiscussionKey(before.activeConversationId));
      if (reset) sessionStorage.removeItem(DRAFT_KEY);
      else {
        const legacyDraftKey = `cycler-input:${before.activeConversationId}`;
        const draft = sessionStorage.getItem(DRAFT_KEY) ?? sessionStorage.getItem(legacyDraftKey) ?? "";
        setInput(draft);
        if (draft) sessionStorage.setItem(DRAFT_KEY, draft);
        sessionStorage.removeItem(legacyDraftKey);
        const savedPosition = JSON.parse(sessionStorage.getItem(RETURN_MESSAGE_KEY) ?? "null") as MessagePosition | null;
        const origin = returnTo ?? savedPosition?.conversationId;
        if (origin) {
          const messages = buildChatTimeline(restored);
          const receiptIds = new Set(receipts.filter(receipt => receipt.conversationId === origin).map(receipt => receipt.receiptId));
          let index = messages.findLastIndex(({ message }) => message.importReceiptId !== undefined && receiptIds.has(message.importReceiptId));
          if (index < 0 && savedPosition?.conversationId === origin) index = messages.findIndex(message => message.conversationId === origin && message.index === savedPosition.index);
          if (index < 0 && sameConversation && origin !== restored.activeConversationId) index = messages.findLastIndex(message => message.conversationId === origin);
          if (index >= 0) {
            scrollTarget.current = messages[index];
            followRepliesRef.current = false;
          }
        }
      }
      sessionStorage.removeItem(RETURN_MESSAGE_KEY);
      if (returnTo) {
        url.searchParams.delete("conversation");
        url.searchParams.delete("discussPlan");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
      }
      if (sameConversation) {
        const raw = JSON.parse(sessionStorage.getItem("cycler-profile-proposal") ?? "null");
        if (raw) {
          const { artifact } = sanitizeChatInteractionPayload({ artifact: { kind: "profile_proposal", payload: raw.input ? raw : { input: raw, previous: {} } } });
          if (artifact?.kind === "profile_proposal") {
            setProposal(artifact.payload.input);
            setPreviousProfile(artifact.payload.previous);
          }
        }
      } else {
        sessionStorage.removeItem("cycler-profile-proposal");
      }
    } catch {
      restored = resumeChatSession(restored, snapshot);
    }
    if (reset === "blank" || (!reset && !stored && !hasExistingSession)) {
      setSetupConversation(restored.activeConversationId);
    }
    const messages = buildChatTimeline(restored);
    const position = scrollTarget.current;
    const targetIndex = position ? messages.findIndex(message => message.conversationId === position.conversationId && message.index === position.index) : -1;
    const pageStart = Math.max(activeTimelineStart(messages, restored.activeConversationId), messages.length - HISTORY_PAGE_SIZE);
    const visibleStart = targetIndex < 0 ? pageStart : Math.min(pageStart, Math.max(0, targetIndex - 4));
    setTimelineStart(messages[visibleStart] ?? null);
    setSession(restored);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSession(current => isChatSessionStale(current, snapshot) ? refreshChatSnapshot(current, snapshot) : current);
  }, [snapshot, snapshotFingerprint]);

  useEffect(() => {
    if (hydrated) storeChatSession(session);
  }, [session, hydrated]);

  function jumpToLatest() {
    followRepliesRef.current = true;
    setShowLatest(false);
    followReply();
  }

  function loadEarlier() {
    if (!firstVisible || prependAnchor.current || scrollTarget.current) return;
    const start = Math.max(0, firstVisible - HISTORY_PAGE_SIZE);
    if (firstVisible >= activeStart && start < activeStart) {
      scrollTarget.current = timeline[Math.max(start, activeStart - 4)];
    } else {
      const element = document.getElementById(messageElementId(timeline[firstVisible]));
      if (element) prependAnchor.current = { element, top: element.getBoundingClientRect().top };
    }
    followRepliesRef.current = false;
    setTimelineStart(timeline[start]);
  }

  useLayoutEffect(() => {
    const container = messagesRef.current;
    if (!hydrated || !container) return;
    const target = scrollTarget.current;
    if (target) {
      scrollTarget.current = null;
      const element = document.getElementById(messageElementId(target));
      if (element) container.scrollTop += element.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
    } else if (prependAnchor.current) {
      const { element, top } = prependAnchor.current;
      container.scrollTop += element.getBoundingClientRect().top - top;
      prependAnchor.current = null;
    } else if (showFirstSetup && !firstSetupPositioned.current && openingRef.current) {
      firstSetupPositioned.current = true;
      container.scrollTop += openingRef.current.getBoundingClientRect().top - container.getBoundingClientRect().top - 8;
    } else if (!showFirstSetup) {
      followReply();
    }
    const awayFromLatest = container.scrollHeight - container.clientHeight - container.scrollTop >= 80;
    if (!followRepliesRef.current) setShowLatest(awayFromLatest);
  }, [hydrated, firstVisible, timeline, pending, proposal, showFirstSetup, followReply]);

  useEffect(() => {
    const content = timelineRef.current;
    const container = messagesRef.current;
    if (!hydrated || showFirstSetup || !content || !container) return;
    const observer = new ResizeObserver(followReply);
    observer.observe(content);
    observer.observe(container);
    return () => observer.disconnect();
  }, [hydrated, showFirstSetup, followReply]);

  const openFreshConversation = useCallback(() => {
    const next = startChatConversation(session, snapshot);
    setSession(current => current.activeConversationId === session.activeConversationId ? startChatConversation(current, snapshot) : current);
    setProposal(null);
    setProposalMessage("");
    setRecommendationIndex(0);
    setTimelineStart(null);
    setShowLatest(false);
    followRepliesRef.current = true;
    prependAnchor.current = null;
    scrollTarget.current = null;
    historyPullStart.current = null;
    historyWheel.current.distance = 0;
    setHistoryPull(0);
    try {
      sessionStorage.removeItem("cycler-profile-proposal");
      sessionStorage.removeItem(planDiscussionKey(session.activeConversationId));
    } catch {}
    return getActiveChatConversation(next);
  }, [session, snapshot, setHistoryPull]);

  useEffect(() => {
    const lastTurnAt = activeConversation.lastTurnAt;
    if (!hydrated || lastTurnAt === undefined) return;
    const deadline = lastTurnAt + CHAT_SESSION_IDLE_MS;
    let timer: number;
    function check() {
      window.clearTimeout(timer);
      const remaining = deadline - Date.now();
      if (remaining > 0) timer = window.setTimeout(check, remaining);
      else if (!document.hidden) {
        if (pending || inFlight.current || savingProfile || hasOpenDialog()) timer = window.setTimeout(check, 1000);
        else openFreshConversation();
      }
    }
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [activeConversation.lastTurnAt, hydrated, openFreshConversation, pending, savingProfile]);

  function rememberReturnPosition(event: MouseEvent<HTMLElement>, position: MessagePosition) {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!link || new URL(link.href, window.location.href).searchParams.get("conversation") !== position.conversationId) return;
    try { sessionStorage.setItem(RETURN_MESSAGE_KEY, JSON.stringify(position)); } catch {}
  }

  function addReply(conversationId: string, userText: string, reply: string, source: ChatSessionSummarySource, turn?: { route?: string; rideAnchor?: string; choice?: ChatChoiceRef; rideScope?: ChatRideScope }, interaction?: ChatAgentInteraction) {
    const slotTurn = turn && isChatRoute(turn.route)
      ? { route: turn.route, rideAnchor: turn.rideAnchor, choice: turn.choice, rideScope: turn.rideScope }
      : undefined;
    const completedAt = Date.now();
    setRevealingConversation(conversationId);
    setSession(current => appendChatTurn(current, userText, reply, source, slotTurn, interaction, conversationId, completedAt));
  }

  function imported(ids: string[], text: string, conversationId = activeConversation.id) {
    setSession(current => appendImportedRides(current, ids, text, conversationId));
  }

  function inspectRide(rideId: string) {
    if (isChatConversationExpired(activeConversation)) return;
    const next = rememberChatRideSelection(session, rideId, activeConversation.id);
    storeChatSession(next); // A detail link can unmount chat before its persistence effect runs.
    setSession(next);
  }

  function beginTurn(userText: string) {
    if (!hydrated || pending || inFlight.current || savingProfile) return null;
    inFlight.current = true;
    const conversation = isChatConversationExpired(activeConversation) ? openFreshConversation() : activeConversation;
    jumpToLatest();
    setPendingTurn({ userText });
    return conversation;
  }

  function endTurn() {
    inFlight.current = false;
    setPendingTurn(null);
  }

  async function ask(userText: string, source: ChatSessionSummarySource, choice?: ChatChoiceRef) {
    const conversation = beginTurn(userText);
    if (!conversation) return;
    try {
      const summaries = buildChatSessionSummaries(conversation);
      try {
        const key = planDiscussionKey(conversation.id);
        const focus = parsePlanDiscussion(JSON.parse(sessionStorage.getItem(key) ?? "null"));
        sessionStorage.removeItem(key);
        if (focus) {
          const { viewPlan } = await planRequest(undefined, `?${new URLSearchParams({ planId: focus.planId, version: String(focus.version) })}`);
          if (viewPlan?.id === focus.planId && viewPlan.version === focus.version && (!focus.date || viewPlan.days.some(day => day.date === focus.date))) {
            summaries.splice(0, Math.max(0, summaries.length - 5));
            summaries.push({ kind: "session_turn", question: planDiscussionText(focus), route: "autonomous_tools" });
          }
        }
      } catch {}
      const result = await requestChatReply(userText, summaries, choice);
      if (result.interaction?.artifact?.kind === "profile_proposal") {
        const payload = result.interaction.artifact.payload;
        setProposal(payload.input); setPreviousProfile(payload.previous); setProposalMessage("");
        try { sessionStorage.setItem("cycler-profile-proposal", JSON.stringify(payload)); } catch {}
      }
      addReply(conversation.id, userText, result.reply ?? CHAT_UNAVAILABLE_REPLY, source, result, result.interaction);
      notifyPlanUpdated();
    } finally {
      endTurn();
    }
  }

  async function generatePlan(intakeVersion: number) {
    const userText = "我已核对当前训练计划信息，请生成训练计划草案。";
    const conversation = beginTurn(userText);
    if (!conversation) throw new Error("请等当前操作完成后再试。");
    try {
      const { viewPlan } = await planRequest({ action: "generate_draft", intakeVersion });
      if (!viewPlan) throw new Error("暂时无法读取草案，可以重试。");
      addReply(conversation.id, userText, "训练计划草案已生成。你可以打开查看安排，核对后再确认启用。", "typed_input", { route: "autonomous_tools" }, {
        artifact: { kind: "training_plan", payload: { planId: viewPlan.id, version: viewPlan.version, intakeVersion: viewPlan.intakeVersion, view: "draft" } },
      });
      notifyPlanUpdated();
    } finally {
      endTurn();
    }
  }

  useEffect(() => {
    if (!hydrated || new URLSearchParams(window.location.search).get("recent") !== "1") return;
    window.history.replaceState(window.history.state, "", "/chat");
    void ask("最近骑行表现怎么样？", "typed_input");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = input.trim();
    if (!value || pending || inFlight.current || savingProfile || !hydrated) return;
    void ask(value, "typed_input");
    setInput("");
    try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
  }

  const currentPlan = trainingPlan?.active ?? trainingPlan?.draft;
  const currentPlanHref = currentPlan ? planDetailHref(currentPlan.id, currentPlan.version, activeConversation.id) : undefined;

  return <section className="chat-home" aria-label="AI 骑行伙伴">
    <header className="topbar chat-plan-header">
      <button type="button" className="brand chat-brand" aria-label="Cycler，打开设置" aria-haspopup="dialog" aria-expanded={settingsOpen} aria-controls="chat-sidebar" onClick={() => setSettingsOpen(true)}>
        <span className="brand-mark"><BikeIcon /></span><span>Cycler</span>
      </button>
      <TrainingPlanBar conversationId={activeConversation.id} data={trainingPlan} />
    </header>

    <SideDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)}>
      <PrototypeSettings />
      <p className="chat-history-note">对话记录保存在本浏览器。在消息顶部下拉可加载历史。</p>
    </SideDrawer>

    <div className="chat-messages" ref={messagesRef} tabIndex={0} role="log" aria-label="与 Cycler 的对话" aria-description={firstVisible > 0 ? "在消息顶部按 Page Up 可查看更早的消息。" : undefined} aria-live="off" onScroll={event => {
      const container = event.currentTarget;
      const nearLatest = container.scrollHeight - container.clientHeight - container.scrollTop < 80;
      followRepliesRef.current = nearLatest;
      setShowLatest(!nearLatest);
    }} onWheel={event => {
      const wheel = historyWheel.current;
      if (!firstVisible || event.currentTarget.scrollTop > HISTORY_TOP_TOLERANCE || -event.deltaY <= Math.abs(event.deltaX)) {
        wheel.distance = 0;
        return;
      }
      if (event.timeStamp - wheel.time > HISTORY_WHEEL_WINDOW_MS) wheel.distance = 0;
      const pixelsPerUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? event.currentTarget.clientHeight : 1;
      wheel.distance -= event.deltaY * pixelsPerUnit;
      wheel.time = event.timeStamp;
      if (wheel.distance >= HISTORY_PULL_DISTANCE) {
        wheel.distance = 0;
        loadEarlier();
      }
    }} onKeyDown={event => {
      if (event.target === event.currentTarget && firstVisible > 0 && event.key === "PageUp" && event.currentTarget.scrollTop <= HISTORY_TOP_TOLERANCE) {
        event.preventDefault();
        loadEarlier();
      }
    }} onTouchStart={event => {
      const atTop = event.currentTarget.scrollTop <= HISTORY_TOP_TOLERANCE;
      const touch = firstVisible > 0 && atTop && event.touches.length === 1 ? event.touches[0] : undefined;
      historyPullStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
      if (!touch) setHistoryPull(0, true);
    }} onTouchMove={event => {
      const start = historyPullStart.current;
      const touch = event.touches[0];
      if (!start || !touch) return;
      const distance = touch.clientY - start.y;
      const atTop = event.currentTarget.scrollTop <= HISTORY_TOP_TOLERANCE;
      const pulling = atTop && distance > Math.abs(touch.clientX - start.x);
      setHistoryPull(pulling ? Math.max(0, distance - 8) : 0);
    }} onTouchEnd={event => {
      const start = historyPullStart.current;
      historyPullStart.current = null;
      const touch = event.changedTouches[0];
      if (!start || !touch) {
        setHistoryPull(0, true);
        return;
      }
      const distance = touch.clientY - start.y;
      const shouldLoad = event.currentTarget.scrollTop <= HISTORY_TOP_TOLERANCE && distance >= HISTORY_PULL_DISTANCE && distance > Math.abs(touch.clientX - start.x);
      setHistoryPull(0, !shouldLoad);
      if (shouldLoad) loadEarlier();
    }} onTouchCancel={() => {
      historyPullStart.current = null;
      setHistoryPull(0, true);
    }}>
      <div className="chat-timeline" data-opening={opening || undefined} ref={timelineRef}>
        {timeline.slice(firstVisible).map(({ conversationId, index, message }, offset) => {
          const archived = conversationId !== activeConversation.id;
          const previous = offset > 0 ? timeline[firstVisible + offset - 1] : undefined;
          const separator = previous && previous.conversationId !== conversationId;
          const position = { conversationId, index };
          const revealing = revealingConversation === conversationId && index === lastUserMessage + 1;
          const artifact = message.interaction?.artifact;
          return <Fragment key={messageElementId(position)}>
            {separator && <p className="chat-conversation-divider">{archived ? "较早的对话" : "新一段对话"}</p>}
            <article id={messageElementId(position)} onClickCapture={event => rememberReturnPosition(event, position)} className={`chat-message chat-message-${message.role}${message.kind === "rides" ? " chat-message-receipt" : ""}`} aria-label={message.role === "assistant" ? "Cycler 的消息" : "你的消息"} aria-busy={revealing || undefined}>
              {message.role === "assistant" && <span className="chat-message-label">Cycler</span>}
              {message.kind === "rides" && <StatusBadge>骑行同步／导入结果</StatusBadge>}
              {message.role === "user" ? <p>{message.text}</p> : artifact?.kind === "training_execution" ? <TrainingExecutionReply reference={artifact.payload} onStale={() => { if (revealing) finishReveal(); }}><ChatReplyText text={message.text} reveal={revealing} onComplete={finishReveal} onProgress={followReply} /></TrainingExecutionReply> : <ChatReplyText text={message.text} reveal={revealing} onComplete={finishReveal} onProgress={followReply} />}
              {!revealing && <>
                {message.interaction && <ChatRideList {...message.interaction} pending={pending} conversationId={conversationId} onInspect={archived ? undefined : inspectRide} onChoose={archived ? undefined : choice => { void ask("请分析我选择的这次骑行。", "typed_input", choice); }} />}
                {!archived && artifact?.kind === "onboarding" && <div className="ux-actions" aria-label="首次使用引导入口">
                  <button disabled={pending} onClick={() => window.dispatchEvent(new Event("cycler-open-profile"))}>完善／查看资料</button>
                  <RideSyncLauncher label="同步／导入骑行" onComplete={imported} conversationId={activeConversation.id} />
                  <button disabled={pending} onClick={() => { if (!pending) void ask("我想制定训练计划。", "typed_input"); }}>制定训练计划</button>
                </div>}
                {!archived && artifact?.kind === "ride_import" && <div className="ux-actions" aria-label="骑行同步导入入口">
                  <RideSyncLauncher onComplete={imported} conversationId={activeConversation.id} />
                </div>}
                {artifact?.kind === "training_plan" && (archived
                  ? artifact.payload.version !== null && artifact.payload.version > 0 && <Link href={planDetailHref(artifact.payload.planId, artifact.payload.version, conversationId)}>查看这版训练计划</Link>
                  : <TrainingPlanCard reference={artifact.payload} conversationId={conversationId} onGenerate={generatePlan} />)}
                {artifact?.kind === "training_execution" && (archived || artifact.payload.date === planToday()
                  ? <Link href={planDetailHref(artifact.payload.planId, artifact.payload.version, conversationId, artifact.payload.date)}>查看这天的训练计划与执行</Link>
                  : <TrainingExecutionCard reference={artifact.payload} conversationId={conversationId} pending={pending} onAsk={text => ask(text, "typed_input")} onImported={imported} />)}
                {!archived && artifact?.kind === "goal_editor" && <div className="ux-actions" aria-label="训练计划入口">
                  <button disabled={pending} onClick={() => { if (!pending) void ask("我想制定训练计划。", "typed_input"); }}>制定训练计划</button>
                  <span>目标在制定本次计划时补充</span>
                </div>}
                {message.kind === "rides" && message.rideIds?.length ? <div className="ux-actions"><Link className="secondary-button" href="/import">查看骑行记录<ArrowIcon /></Link></div> : null}
              </>}
            </article>
          </Fragment>;
        })}
        {proposal && !revealingConversation && <section className="ux-card" aria-label="待确认个人资料">
          <StatusBadge tone="pending">聊天资料补充 · 待确认</StatusBadge><h2>核对后再保存</h2>
          <p>以下内容将替换对应的已保存值。若有冲突，请先修改或取消；未列出的字段保留。</p>
          <dl>{Object.entries(proposal).map(([key, value]) => <div key={key}><dt>{PROFILE_LABELS[key as keyof ProfileInput]}</dt><dd>{previousProfile[key as keyof ProfileInput] !== undefined && previousProfile[key as keyof ProfileInput] !== value ? `${previousProfile[key as keyof ProfileInput]} → ${value === null ? "不知道／未提供" : value}（请确认变更）` : value === null ? (key === "maxHeartRateBpm" ? "不知道（如有年龄，保留明确标识的系统估算）" : "未提供，确认后清除已保存值") : value}</dd></div>)}</dl>
          <p>最大心率可能由年龄估算，估算不等于实测，来源可在资料页查看。</p>
          <div className="ux-actions"><button className="primary-button" disabled={savingProfile} onClick={async () => {
            if (isChatConversationExpired(activeConversation)) { openFreshConversation(); return; }
            setSavingProfile(true); setProposalMessage("");
            try {
              const r = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(proposal) });
              if (!r.ok) throw Error();
              setProposal(null); sessionStorage.removeItem("cycler-profile-proposal"); setProposalMessage("已确认保存，可在「我的」查看来源与更新时间。");
              window.dispatchEvent(new Event("cycler-profile-saved"));
            } catch { setProposalMessage("保存失败，待确认内容已保留，请重试。"); } finally { setSavingProfile(false); }
          }}>确认保存资料</button><Link href="/profile" onClick={() => { setProposal(null); sessionStorage.removeItem("cycler-profile-proposal"); }}>到资料页修改</Link><button disabled={savingProfile} onClick={() => { setProposal(null); sessionStorage.removeItem("cycler-profile-proposal"); }}>取消</button></div>
        </section>}
        {proposalMessage && <p role="status">{proposalMessage}</p>}
        <section className="chat-opening" ref={openingRef} aria-label="开始聊天" hidden={!opening}>
          {firstVisible < activeStart && activeStart === timeline.length && <p className="chat-conversation-divider">新一段对话</p>}
          {opening && trainingPlan?.active && <TrainingExecutionCard key={activeConversation.id} conversationId={activeConversation.id} pending={pending} onAsk={text => ask(text, "typed_input")} onImported={imported} />}
          <div className="chat-opening-prompt">
            {opening && <>
              <h1>你好，我是 Cycler</h1>
              <p>一起看懂骑行，安排下一次训练。</p>
            </>}
            <Onboarding
              visible={showFirstSetup}
              rideCount={snapshot.totalRideCount}
              onImported={imported}
              conversationId={activeConversation.id}
              planHref={currentPlanHref}
              pending={pending}
              onStartPlan={() => { void ask("我想制定训练计划。", "typed_input"); }}
            />
            {opening && <div>
              <div className="chat-prompt-buttons chat-recommendation-list" role="group" aria-label="推荐问题" aria-live="polite">
                {recommendationGroups[recommendationIndex].map(question => <button key={question} type="button" disabled={savingProfile} onClick={() => void ask(question, "quick_question")}>{question}</button>)}
              </div>
              <button className="chat-refresh-recommendations" type="button" onClick={() => setRecommendationIndex(index => (index + 1) % recommendationGroups.length)}>
                <RefreshIcon />换一换
              </button>
            </div>}
          </div>
        </section>
        {pendingTurn && <>
          <article className="chat-message chat-message-user"><p>{pendingTurn.userText}</p></article>
          <ChatPendingReply />
        </>}
      </div>
    </div>

    <div className="chat-composer">
      {showLatest && <button type="button" className="chat-history-control chat-latest-control" onClick={jumpToLatest}>回到最新消息 ↓</button>}
      <div className="chat-prompt-buttons" role="group" aria-label="快捷提问">
        <button type="button" disabled={!hydrated || pending || savingProfile} onClick={() => void ask("帮我解读最近一次骑行。", "quick_question")}>骑行数据解读</button>
        <button type="button" disabled={!hydrated || pending || savingProfile} onClick={() => void ask("我想制定新的训练计划。", "quick_question")}>训练计划生成</button>
      </div>
      <form className="chat-input-form" onSubmit={submit}>
        {disclosureOpen && <p className="chat-disclosure-popover" role="note">可解读骑行、查询近期表现、解释骑行知识，准备训练草案，评估本人已确认关联的训练记录；计划启用、删除和记录关联需明确确认。{liveOneLap ? "此账号可手动同步顽鹿记录，其他平台提供模拟体验。" : "此账号可体验模拟平台同步。"}也可上传 FIT 或 GPX 文件。对话记录保存在本浏览器。</p>}
        <label className="sr-only" htmlFor="chat-input">输入问题</label>
        <input id="chat-input" value={input} onChange={(event) => { setInput(event.target.value); try { sessionStorage.setItem(DRAFT_KEY, event.target.value); } catch {} }} maxLength={120} placeholder="问问你的骑行伙伴" disabled={!hydrated || pending || savingProfile} />
        <button type="button" className="chat-info-button" aria-label="能力说明" aria-expanded={disclosureOpen} onClick={() => setDisclosureOpen((open) => !open)}><InfoIcon /></button>
        <button type="submit" disabled={!hydrated || !input.trim() || pending || savingProfile}>发送</button>
      </form>
    </div>
  </section>;
}
