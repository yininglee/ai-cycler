"use client";
import { StatusBadge } from "./status-badge";
import { isChatRideScope, type ChatRideScope } from "../../src/chat/chat-context.ts";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  type ChatHomeSnapshot,
  type ChatMessage,
} from "../../src/chat/chat-home.ts";
import { CHAT_IMPORT_QUEUE_KEY, parseImportReceipts, restoreImportReceipts } from "../../src/chat/chat-import";
import { ChatRideList } from "./chat-ride-list";
import { sanitizeChatInteractionPayload, isChatChoiceRef, type ChatChoiceRef, type ChatAgentInteraction } from "../../src/chat/chat-interaction";
import { RideSyncLauncher } from "./ride-sync";
import { TrainingPlanBar, TrainingPlanCard, notifyPlanUpdated, planRequest, planDetailHref } from "./training-plan";
import { planToday } from "../../src/domain/training-plan";
import { TrainingExecutionCard, TrainingExecutionReply } from "./training-execution";
import { parsePlanDiscussion, planDiscussionKey, planDiscussionText, type PlanDiscussion } from "../../src/training/plan-discussion";
import { SideDrawer } from "./side-drawer";
import { ChatReplyText } from "./chat-reply-text";
import { Onboarding, PrototypeSettings } from "./ux-onboarding";
import { PROFILE_LABELS } from "../../src/chat/profile-proposal";
import type { ProfileInput } from "../../src/domain/user-profile";
import Link from "next/link";
import { ArrowIcon, BikeIcon, InfoIcon } from "./icons";
import {
  appendChatTurn,
  appendImportedRides,
  rememberChatRideSelection,
  refreshChatSnapshot,
  buildChatSessionSummaries,
  chatHomeSnapshotFingerprint,
  createChatSession,
  getActiveChatConversation,
  isChatSessionStale,
  readStoredChatSession,
  selectChatConversation,
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

function conversationTitle(messages: ChatMessage[]) {
  return messages.find((message) => message.role === "user")?.text ?? "新对话";
}

export function ChatHome({ snapshot }: { snapshot: ChatHomeSnapshot }) {
  const [previousProfile, setPreviousProfile] = useState<ProfileInput>({});
  const [proposal, setProposal] = useState<ProfileInput | null>(null);
  const [proposalMessage, setProposalMessage] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [session, setSession] = useState(() => createChatSession(snapshot));
  const [input, setInput] = useState("");
  const [revealingMessage, setRevealingMessage] = useState<{ conversationId: string; index: number } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [planFocus, setPlanFocus] = useState<(PlanDiscussion & { conversationId: string }) | null>(null);
  const [pendingTurn, setPendingTurn] = useState<{ userText: string } | null>(null);
  const restoredSessionRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const pendingScrollRestore = useRef<number | null>(null);
  const followRepliesRef = useRef(true);
  const finishReveal = useCallback(() => setRevealingMessage(null), []);
  const followReply = useCallback(() => {
    const container = messagesRef.current;
    if (container && followRepliesRef.current) container.scrollTop = container.scrollHeight;
  }, []);
  const snapshotFingerprint = chatHomeSnapshotFingerprint(snapshot);

  const activeConversation = getActiveChatConversation(session);
  const messages = activeConversation.messages;
  const pending = pendingTurn !== null || revealingMessage?.conversationId === activeConversation.id;
  const activePlanFocus = planFocus?.conversationId === activeConversation.id ? planFocus : null;

  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    setPlanFocus(null);
    try {
      const focus = parsePlanDiscussion(JSON.parse(sessionStorage.getItem(planDiscussionKey(activeConversation.id)) ?? "null"));
      if (focus) void planRequest(undefined, `?${new URLSearchParams({ planId: focus.planId, version: String(focus.version) })}`).then(data => {
        if (live && data.viewPlan?.id === focus.planId && data.viewPlan.version === focus.version && (!focus.date || data.viewPlan.days.some(day => day.date === focus.date))) setPlanFocus({ ...focus, conversationId: activeConversation.id });
      }).catch(() => {});
    } catch {}
    return () => { live = false; };
  }, [hydrated, activeConversation.id]);

  useEffect(() => {
    if (messages.some(m => m.role === "user") && followRepliesRef.current) followReply();
  }, [messages, pendingTurn, proposal, followReply]);

  // 刷新后从本地浏览器恢复对话；骑行数据变化时更新摘要，继续当前对话
  useEffect(() => {
    if (restoredSessionRef.current) return;
    restoredSessionRef.current = true;
    try {
      const raw = sessionStorage.getItem("cycler-profile-proposal");
      if (raw) {
        const parsed = JSON.parse(raw);
        const { artifact } = sanitizeChatInteractionPayload({ artifact: { kind: "profile_proposal", payload: parsed.input ? parsed : { input: parsed, previous: {} } } });
        if (artifact?.kind === "profile_proposal") { setProposal(artifact.payload.input); setPreviousProfile(artifact.payload.previous); }
      }
    } catch {}
    const stored = readStoredChatSession();
    let restored = stored ? refreshChatSnapshot(stored, snapshot) : createChatSession(snapshot);
    if (sessionStorage.getItem("cycler-reset-chat")) {
      sessionStorage.removeItem("cycler-reset-chat");
      restored = stored ? startChatConversation(restored, snapshot) : restored;
    }
    try {
      const receipts = parseImportReceipts(JSON.parse(sessionStorage.getItem(CHAT_IMPORT_QUEUE_KEY) ?? "[]"), restored.activeConversationId);
      const returnTo = new URLSearchParams(window.location.search).get("conversation") ?? undefined;
      restored = restoreImportReceipts(restored, receipts, returnTo);
      // Persist before acknowledgement; receipt IDs make a repeated restore harmless.
      if (storeChatSession(restored)) sessionStorage.removeItem(CHAT_IMPORT_QUEUE_KEY);
      if (returnTo) { const url = new URL(window.location.href); url.searchParams.delete("conversation"); window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`); }
    } catch {}
    setSession(restored);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSession((current) => isChatSessionStale(current, snapshot) ? refreshChatSnapshot(current, snapshot) : current);
  }, [snapshot, snapshotFingerprint]);

  useEffect(() => {
    if (hydrated) storeChatSession(session);
  }, [session, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      setInput(sessionStorage.getItem(`cycler-input:${activeConversation.id}`) ?? "");
      const position = sessionStorage.getItem(`cycler-scroll:${activeConversation.id}`);
      if (position !== null && messagesRef.current) {
        pendingScrollRestore.current = Number(position);
        messagesRef.current.scrollTop = Number(position);
        followRepliesRef.current = false;
      }
    } catch {}
  }, [hydrated, activeConversation.id]);

  useEffect(() => {
    const restore = () => {
      const position = pendingScrollRestore.current;
      const container = messagesRef.current;
      if (position === null || !container) return;
      container.scrollTop = position;
      if (Math.abs(container.scrollTop - position) < 2) pendingScrollRestore.current = null;
    };
    window.addEventListener("cycler-rides-ready", restore);
    return () => window.removeEventListener("cycler-rides-ready", restore);
  }, []);

  // CHAT-14 P1：turn 携带服务端返回的 route/rideAnchor 时记 session_turn 槽位（供后续继承与挂起确认识别）。
  function addReply(userText: string, reply: string | null, source: ChatSessionSummarySource, turn?: { route?: string; rideAnchor?: string; choice?: ChatChoiceRef; rideScope?: ChatRideScope }, interaction?: ChatAgentInteraction) {
    if (!reply) return;
    pendingScrollRestore.current = null;
    followRepliesRef.current = true;
    setRevealingMessage({ conversationId: activeConversation.id, index: messages.length + 1 });
    const slotTurn = turn && isChatRoute(turn.route)
      ? { route: turn.route, ...(turn.rideAnchor ? { rideAnchor: turn.rideAnchor } : {}), ...(turn.choice ? { choice: turn.choice } : {}), ...(turn.rideScope ? { rideScope: turn.rideScope } : {}) }
      : undefined;
    setSession((current) => appendChatTurn(current, userText, reply, source, slotTurn, interaction, activeConversation.id));
  }

  function imported(ids: string[], text: string, conversationId = activeConversation.id) {
    pendingScrollRestore.current = null;
    followRepliesRef.current = true;
    setSession(current => appendImportedRides(current, ids, text, conversationId));
  }

  function inspectRide(rideId: string) {
    const next = rememberChatRideSelection(session, rideId, activeConversation.id);
    storeChatSession(next); // A detail link can unmount chat before its persistence effect runs.
    setSession(next);
  }

  async function ask(userText: string, source: ChatSessionSummarySource, choice?: ChatChoiceRef) {
    followRepliesRef.current = true;
    setPendingTurn({ userText });
    // CHAT-14 P1：携带当前对话白名单摘要请求服务端（指代消解/锚点继承依赖）。
    const summaries = buildChatSessionSummaries(activeConversation);
    if (activePlanFocus) {
      summaries.splice(0, Math.max(0, summaries.length - 5));
      summaries.push({ kind: "session_turn", question: planDiscussionText(activePlanFocus), route: "autonomous_tools" });
      // Hand off the detail reference once; subsequent turns use normal
      // conversation context rather than repeatedly pinning an old plan.
      try { sessionStorage.removeItem(planDiscussionKey(activeConversation.id)); } catch {}
      setPlanFocus(null);
    }
    const result = await requestChatReply(userText, summaries, choice);
    setPendingTurn(null);
    if (result.interaction?.artifact?.kind === "profile_proposal") {
      const payload = result.interaction.artifact.payload;
      setProposal(payload.input); setPreviousProfile(payload.previous); setProposalMessage("");
      sessionStorage.setItem("cycler-profile-proposal", JSON.stringify(payload));
    }
    addReply(userText, result.reply, source, { route: result.route, rideAnchor: result.rideAnchor, choice: result.choice, rideScope: result.rideScope }, result.interaction);
    notifyPlanUpdated();
  }

  useEffect(() => {
    if (!hydrated || new URLSearchParams(window.location.search).get("recent") !== "1") return;
    window.history.replaceState(window.history.state, "", "/chat");
    void ask("最近骑行表现怎么样？", "typed_input");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  function startConversation() {
    setSession((current) => startChatConversation(current, snapshot));
    setInput("");
    setHistoryOpen(false);
  }

  function openConversation(id: string) {
    setSession((current) => selectChatConversation(current, id));
    setHistoryOpen(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = input.trim();
    if (!value || pending) return;
    setInput("");
    try { sessionStorage.removeItem(`cycler-input:${activeConversation.id}`); } catch {}
    // CHAT-12 P1：聚合问题由服务端 "aggregate" 路由确定性作答，不再客户端拦截。
    // 2026-10-24 回归修复：不再传本地正则兜底，失败就如实降级（见 CHAT_UNAVAILABLE_REPLY）。
    void ask(value, "typed_input");
  }

  return <section className="chat-home" aria-label="AI 骑行伙伴">
    <header className="topbar">
      <button type="button" className="brand chat-brand" aria-label="Cycler，打开侧边抽屉" aria-haspopup="dialog" aria-expanded={historyOpen} aria-controls="chat-sidebar" onClick={() => setHistoryOpen(true)}>
        <span className="brand-mark"><BikeIcon /></span><span>Cycler</span>
      </button>
    </header>

    <TrainingPlanBar conversationId={activeConversation.id} />

    <SideDrawer open={historyOpen} onClose={() => setHistoryOpen(false)}>
        <button type="button" className="primary-button chat-new-conversation" disabled={pending} onClick={startConversation}>＋ 新对话</button>
        <h2 className="chat-drawer-section-title">对话记录</h2>
      <div className="chat-history-list">
        {session.conversations.slice().reverse().map((conversation) => <button
          className={conversation.id === session.activeConversationId ? "active" : ""}
          key={conversation.id}
          type="button"
          disabled={pending}
          aria-current={conversation.id === session.activeConversationId ? "true" : undefined}
          onClick={() => openConversation(conversation.id)}
        >
          <span>{conversationTitle(conversation.messages)}</span>
          <small>{conversation.messages.filter((message) => message.role === "user").length} 条提问</small>
        </button>)}
      </div>
      <PrototypeSettings />
      <p className="chat-history-note">对话记录保存在本浏览器本地；同步或导入后继续当前对话。</p>
    </SideDrawer>

    <div className="chat-messages" ref={messagesRef} onWheel={() => { pendingScrollRestore.current = null; }} onTouchStart={() => { pendingScrollRestore.current = null; }} role="log" aria-label="与 Cycler 的对话" aria-live="off" onScroll={event => {
      const container = event.currentTarget;
      if (pendingScrollRestore.current === null) try { sessionStorage.setItem(`cycler-scroll:${activeConversation.id}`, String(container.scrollTop)); } catch {}
      followRepliesRef.current = container.scrollHeight - container.clientHeight - container.scrollTop < 80;
    }}>
      {messages.map((message, index) => {
        const welcome = message.role === "assistant" && (message.kind === "welcome" || index === 0);
        const revealing = revealingMessage?.conversationId === activeConversation.id && revealingMessage.index === index;
        return <article key={`${activeConversation.id}-${index}`} className={`chat-message chat-message-${message.role}${welcome ? " chat-message-welcome" : ""}${message.kind === "rides" ? " chat-message-receipt" : ""}`} aria-label={message.role === "assistant" ? "Cycler 的消息" : "你的消息"} aria-busy={revealing || undefined}>
          {message.role === "assistant" && <span className="chat-message-label">Cycler</span>}
          {message.role === "assistant" && message.kind === "rides" && <StatusBadge>骑行同步／导入结果</StatusBadge>}
          {welcome ? <Onboarding rideCount={snapshot.totalRideCount} onImported={imported} conversationId={activeConversation.id} pending={pending} onStartPlan={() => { if (!pending) void ask("我想制定训练计划。", "typed_input"); }} /> : message.role === "assistant" ? message.interaction?.artifact?.kind === "training_execution" ? <TrainingExecutionReply reference={message.interaction.artifact.payload} onStale={() => { if (revealing) finishReveal(); }}><ChatReplyText text={message.text} reveal={revealing} onComplete={finishReveal} onProgress={followReply} /></TrainingExecutionReply> : <ChatReplyText text={message.text} reveal={revealing} onComplete={finishReveal} onProgress={followReply} /> : <p>{message.text}</p>}
          {message.interaction && <ChatRideList {...message.interaction} pending={pending} conversationId={activeConversation.id} onInspect={inspectRide} onChoose={choice => { if (!pending) void ask("请分析我选择的这次骑行。", "typed_input", choice); }} />}
          {message.interaction?.artifact?.kind === "onboarding" && <div className="ux-actions" aria-label="首次使用引导入口">
            <button disabled={pending} onClick={() => window.dispatchEvent(new Event("cycler-open-profile"))}>完善／查看资料</button>
            <RideSyncLauncher label="同步／导入骑行" onComplete={imported} conversationId={activeConversation.id} />
            <button disabled={pending} onClick={() => { if (!pending) void ask("我想制定训练计划。", "typed_input"); }}>制定训练计划</button>
          </div>}
          {message.interaction?.artifact?.kind === "ride_import" && <div className="ux-actions" aria-label="骑行同步导入入口">
            <RideSyncLauncher onComplete={imported} conversationId={activeConversation.id} />
          </div>}
          {message.interaction?.artifact?.kind === "training_plan" && <TrainingPlanCard reference={message.interaction.artifact.payload} conversationId={activeConversation.id} onGenerate={async () => { await ask("我已核对当前训练计划信息，请生成训练计划草案。", "typed_input"); notifyPlanUpdated(); }} />}
          {message.interaction?.artifact?.kind === "training_execution" && (message.interaction.artifact.payload.date === planToday() ? <Link href={planDetailHref(message.interaction.artifact.payload.planId, message.interaction.artifact.payload.version, activeConversation.id, message.interaction.artifact.payload.date)}>查看这天的训练计划与执行</Link> : <TrainingExecutionCard reference={message.interaction.artifact.payload} conversationId={activeConversation.id} pending={pending} onAsk={text => ask(text, "typed_input")} onImported={imported} />)}
          {message.interaction?.artifact?.kind === "goal_editor" && <div className="ux-actions" aria-label="训练计划入口">
            <button disabled={pending} onClick={() => { if (!pending) void ask("我想制定训练计划。", "typed_input"); }}>制定训练计划</button>
            <span>目标在制定本次计划时补充</span>
          </div>}
          {message.kind === "rides" && message.rideIds?.length ? <div className="ux-actions"><Link className="secondary-button" href="/import">查看骑行记录<ArrowIcon /></Link></div> : null}
        </article>;
      })}
      {proposal && <section className="ux-card" aria-label="待确认个人资料">
        <StatusBadge tone="pending">聊天资料补充 · 待确认</StatusBadge><h2>核对后再保存</h2>
        <p>以下内容将替换对应的已保存值。若有冲突，请先修改或取消；未列出的字段保留。</p>
        <dl>{Object.entries(proposal).map(([key, value]) => <div key={key}><dt>{PROFILE_LABELS[key as keyof ProfileInput]}</dt><dd>{previousProfile[key as keyof ProfileInput] !== undefined && previousProfile[key as keyof ProfileInput] !== value ? `${previousProfile[key as keyof ProfileInput]} → ${value === null ? "不知道／未提供" : value}（请确认变更）` : value === null ? (key === "maxHeartRateBpm" ? "不知道（如有年龄，保留明确标识的系统估算）" : "未提供，确认后清除已保存值") : value}</dd></div>)}</dl>
        <p>最大心率可能由年龄估算，估算不等于实测，来源可在资料页查看。</p>
        <div className="ux-actions"><button className="primary-button" disabled={savingProfile} onClick={async () => {
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
      {hydrated && <TrainingExecutionCard key={activeConversation.id} conversationId={activeConversation.id} pending={pending} onAsk={text => ask(text, "typed_input")} onImported={imported} />}
      {pendingTurn && <>
        <article className="chat-message chat-message-user"><p>{pendingTurn.userText}</p></article>
        <ChatPendingReply />
      </>}
      <div ref={messagesEndRef} />
    </div>

    <div className="chat-composer">
      <form className="chat-input-form" onSubmit={submit}>
        {disclosureOpen && <p className="chat-disclosure-popover" role="note">可解读骑行、查询近期表现、解释骑行知识，准备训练草案，评估本人已确认关联的训练记录；计划启用、删除和记录关联需明确确认。平台同步为模拟；对话记录保存在本浏览器。</p>}
        <label className="sr-only" htmlFor="chat-input">输入问题</label>
        <input id="chat-input" value={input} onChange={(event) => { setInput(event.target.value); try { sessionStorage.setItem(`cycler-input:${activeConversation.id}`, event.target.value); } catch {} }} maxLength={120} placeholder="问问你的骑行伙伴" disabled={pending} />
        <button type="button" className="chat-info-button" aria-label="能力说明" aria-expanded={disclosureOpen} onClick={() => setDisclosureOpen((open) => !open)}><InfoIcon /></button>
        <button type="submit" disabled={!input.trim() || pending}>发送</button>
      </form>
    </div>
  </section>;
}
