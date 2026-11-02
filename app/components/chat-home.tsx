"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  type ChatHomeSnapshot,
  type ChatMessage,
} from "../../src/chat/chat-home.ts";
import { ChatRideList } from "./chat-ride-list";
import { sanitizeChatInteractionPayload, isChatChoiceRef, type ChatChoiceRef, type ChatAgentInteraction } from "../../src/chat/chat-interaction";
import { RideSyncLauncher } from "./ride-sync";
import { RideRecordCards } from "./ride-record-cards";
import { SideDrawer } from "./side-drawer";
import { ChatReplyText } from "./chat-reply-text";
import { readProfile } from "./profile-client";
import { Onboarding, PrototypeSettings } from "./ux-onboarding";
import { proposeProfile, PROFILE_LABELS } from "../../src/chat/profile-proposal";
import type { ProfileInput } from "../../src/domain/user-profile";
import Link from "next/link";
import { BikeIcon, InfoIcon } from "./icons";
import {
  appendChatTurn,
  appendImportedRides,
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

async function requestChatReply(text: string, summaries: ChatSessionSummary[], choice?: ChatChoiceRef): Promise<{ reply: string | null; route?: string; rideAnchor?: string; choice?: ChatChoiceRef; interaction?: ChatAgentInteraction }> {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, ...(summaries.length ? { summaries } : {}), ...(choice ? { choice } : {}) }),
    });
    if (!response.ok) { const body = await response.json().catch(() => null); return { reply: body?.error === "NOT_FOUND" ? "所选骑行已不可用，请重新选择记录。" : CHAT_UNAVAILABLE_REPLY }; }
    const payload: unknown = await response.json();
    const record = payload as { reply?: unknown; rideAnchor?: unknown; decision?: { route?: unknown }; choice?: unknown; artifact?: unknown; choices?: unknown; quickActions?: unknown } | null;
    const reply = record?.reply;
    const rideAnchor = record?.rideAnchor;
    const route = record?.decision?.route;
    const { droppedFields: _dropped, ...interaction } = sanitizeChatInteractionPayload(record ?? {});
    return {
      interaction,
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
  const pending = pendingTurn !== null || revealingMessage !== null;

  useEffect(() => {
    if (messages.some(m => m.role === "user") && followRepliesRef.current) followReply();
  }, [messages, pendingTurn, proposal, followReply]);

  // 刷新后从本地浏览器恢复对话；骑行数据变化时更新摘要，继续当前对话
  useEffect(() => {
    if (restoredSessionRef.current) return;
    restoredSessionRef.current = true;
    try { const draft = sessionStorage.getItem("cycler-profile-proposal"); if (draft) setProposal(JSON.parse(draft)); } catch {}
    const stored = readStoredChatSession();
    if (sessionStorage.getItem("cycler-reset-chat")) {
      sessionStorage.removeItem("cycler-reset-chat");
      setSession(stored ? startChatConversation(stored, snapshot) : createChatSession(snapshot));
    } else if (stored) setSession(isChatSessionStale(stored, snapshot) ? refreshChatSnapshot(stored, snapshot) : stored);
    try {
      const pending: unknown = JSON.parse(sessionStorage.getItem("cycler-import-results") ?? "[]");
      sessionStorage.removeItem("cycler-import-results");
      if (Array.isArray(pending)) for (const item of pending) {
        if (typeof item?.text === "string" && Array.isArray(item.ids) && item.ids.every((id: unknown) => typeof id === "string")) {
          setSession(current => appendImportedRides(current, item.ids, item.text, typeof item.conversationId === "string" ? item.conversationId : current.activeConversationId));
        }
      }
    } catch {}
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
  function addReply(userText: string, reply: string | null, source: ChatSessionSummarySource, turn?: { route?: string; rideAnchor?: string; choice?: ChatChoiceRef }, interaction?: ChatAgentInteraction) {
    if (!reply) return;
    pendingScrollRestore.current = null;
    followRepliesRef.current = true;
    setRevealingMessage({ conversationId: activeConversation.id, index: messages.length + 1 });
    const slotTurn = turn && isChatRoute(turn.route)
      ? { route: turn.route, ...(turn.rideAnchor ? { rideAnchor: turn.rideAnchor } : {}), ...(turn.choice ? { choice: turn.choice } : {}) }
      : undefined;
    setSession((current) => appendChatTurn(current, userText, reply, source, slotTurn, interaction));
  }

  function imported(ids: string[], text: string) {
    pendingScrollRestore.current = null;
    followRepliesRef.current = true;
    setSession(current => appendImportedRides(current, ids, text));
  }

  async function ask(userText: string, source: ChatSessionSummarySource, choice?: ChatChoiceRef) {
    followRepliesRef.current = true;
    const resultProfile = proposeProfile(userText);
    if (resultProfile) {
      if (resultProfile.input) {
        try {
          const saved = await readProfile();
          setPreviousProfile({ age: saved.age?.value, heightCm: saved.heightCm?.value, weightKg: saved.weightKg?.value, maxHeartRateBpm: saved.maxHeartRate?.valueBpm, ftpWatts: saved.ftp?.valueWatts });
        } catch { addReply(userText, "资料暂时无法读取，请稍后重试；本次内容尚未保存。", source); return; }
        setProposal(resultProfile.input);
        sessionStorage.setItem("cycler-profile-proposal", JSON.stringify(resultProfile.input));
        setProposalMessage("");
      }
      addReply(userText, resultProfile.clarification ?? "我整理了待保存资料。请核对下方卡片；已有字段将被替换，确认前不会写入。", source);
      return;
    }
    if (/(?:我的目标|设置目标|修改目标|目标是)/.test(userText)) {
      addReply(userText, "请通过「设置目标」卡片补充并核对主要目标，也可以到「我的」修改。目标确认后才会保存。", source);
      window.dispatchEvent(new CustomEvent("cycler-goal-draft", { detail: userText }));
      return;
    }
    setPendingTurn({ userText });
    // CHAT-14 P1：携带当前对话白名单摘要请求服务端（指代消解/锚点继承依赖）。
    const summaries = buildChatSessionSummaries(activeConversation);
    const result = await requestChatReply(userText, summaries, choice);
    setPendingTurn(null);
    addReply(userText, result.reply, source, { route: result.route, rideAnchor: result.rideAnchor, choice: result.choice }, result.interaction);
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
        return <article key={`${activeConversation.id}-${index}`} className={`chat-message chat-message-${message.role}${welcome ? " chat-message-welcome" : ""}`} aria-label={message.role === "assistant" ? "Cycler 的消息" : "你的消息"} aria-busy={revealing || undefined}>
          {message.role === "assistant" && <span className="chat-message-label">Cycler</span>}
          {welcome ? <Onboarding rideCount={snapshot.totalRideCount} onImported={imported} /> : message.role === "assistant" ? <ChatReplyText text={message.text} reveal={revealing} onComplete={finishReveal} onProgress={followReply} /> : <p>{message.text}</p>}
          {message.interaction && <ChatRideList {...message.interaction} pending={pending} onChoose={choice => { if (!pending) void ask("请分析我选择的这次骑行。", "typed_input", choice); }} />}
          {message.kind === "rides" && message.rideIds?.length ? <RideRecordCards ids={message.rideIds} fromChat /> : null}
        </article>;
      })}
      {proposal && <section className="ux-card" aria-label="待确认个人资料">
        <p className="kicker">聊天资料补充 · 规则识别原型</p><h2>核对后再保存</h2>
        <p>以下内容将替换对应的已保存值。若有冲突，请先修改或取消；未列出的字段保留。</p>
        <dl>{Object.entries(proposal).map(([key, value]) => <div key={key}><dt>{PROFILE_LABELS[key as keyof ProfileInput]}</dt><dd>{previousProfile[key as keyof ProfileInput] !== undefined && previousProfile[key as keyof ProfileInput] !== value ? `${previousProfile[key as keyof ProfileInput]} → ${value}（请确认变更）` : value}</dd></div>)}</dl>
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
      {pendingTurn && <>
        <article className="chat-message chat-message-user"><p>{pendingTurn.userText}</p></article>
        <ChatPendingReply />
      </>}
      <div ref={messagesEndRef} />
    </div>

    <div className="chat-composer">
      <div className="chat-sync-action"><RideSyncLauncher onComplete={imported} /></div>
      <form className="chat-input-form" onSubmit={submit}>
        {disclosureOpen && <p className="chat-disclosure-popover" role="note">单次骑行与能力问题调用对话模型（扣子 Workflow，服务端校验并降级）；累计/本周类问题由服务端确定性计算；跨次比较与水平评估属后续能力；对话记录保存在本浏览器。</p>}
        <label className="sr-only" htmlFor="chat-input">输入问题</label>
        <input id="chat-input" value={input} onChange={(event) => { setInput(event.target.value); try { sessionStorage.setItem(`cycler-input:${activeConversation.id}`, event.target.value); } catch {} }} maxLength={120} placeholder="问问你的骑行伙伴" disabled={pending} />
        <button type="button" className="chat-info-button" aria-label="能力说明" aria-expanded={disclosureOpen} onClick={() => setDisclosureOpen((open) => !open)}><InfoIcon /></button>
        <button type="submit" disabled={!input.trim() || pending}>发送</button>
      </form>
    </div>
  </section>;
}
