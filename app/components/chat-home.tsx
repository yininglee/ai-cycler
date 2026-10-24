"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  type ChatHomeSnapshot,
  type ChatMessage,
} from "../../src/chat/chat-home.ts";
import { Brand } from "./app-shell";
import { CheckIcon, InfoIcon } from "./icons";
import {
  appendChatTurn,
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

async function requestChatReply(text: string, summaries: ChatSessionSummary[]): Promise<{ reply: string | null; route?: string; rideAnchor?: string }> {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(summaries.length ? { text, summaries } : { text }),
    });
    if (!response.ok) return { reply: CHAT_UNAVAILABLE_REPLY };
    const payload: unknown = await response.json();
    const record = payload as { reply?: unknown; rideAnchor?: unknown; decision?: { route?: unknown } } | null;
    const reply = record?.reply;
    const rideAnchor = record?.rideAnchor;
    const route = record?.decision?.route;
    return {
      reply: typeof reply === "string" && reply.trim() ? reply : CHAT_UNAVAILABLE_REPLY,
      ...(isChatRoute(route) ? { route } : {}),
      ...(typeof rideAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rideAnchor) ? { rideAnchor } : {}),
    };
  } catch {
    return { reply: CHAT_UNAVAILABLE_REPLY };
  }
}

// CHAT 等待态：服务端是一次请求（路由判定 → 工具取数 → 模型生成），拿不到细粒度进度，
// 这里按固定节奏模拟三段状态，让等待过程可感知。最后一段保持转圈直到响应返回。
const CHAT_PENDING_STEPS = [
  { label: "理解你的问题", active: "正在理解你的问题…" },
  { label: "获取本次骑行数据", active: "正在获取本次骑行数据…" },
  { label: "生成回复", active: "生成回复中…" },
];
const CHAT_PENDING_STEP_DELAYS_MS = [1100, 3400];

function ChatPendingReply() {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const timers = CHAT_PENDING_STEP_DELAYS_MS.map((delay, index) =>
      window.setTimeout(() => setActiveStep(index + 1), delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return <article className="chat-message chat-message-assistant">
    <span className="chat-message-label">AI 伙伴</span>
    <ol className="chat-pending-list" role="status" aria-live="polite">
      {CHAT_PENDING_STEPS.map((step, index) => {
        const status = index < activeStep ? "done" : index === activeStep ? "active" : "pending";
        return <li className={`chat-pending-step is-${status}`} key={step.label}>
          <span className="chat-pending-mark" aria-hidden="true">{status === "done" && <CheckIcon />}</span>
          <span className="chat-pending-text">{status === "active" ? step.active : step.label}</span>
        </li>;
      })}
    </ol>
  </article>;
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return <article className={`chat-message chat-message-${message.role}`}>
    {message.role === "assistant" && <span className="chat-message-label">AI 伙伴</span>}
    <p>{message.text}</p>
  </article>;
}

function conversationTitle(messages: ChatMessage[]) {
  return messages.find((message) => message.role === "user")?.text ?? "新对话";
}

export function ChatHome({ snapshot }: { snapshot: ChatHomeSnapshot }) {
  const [session, setSession] = useState(() => createChatSession(snapshot));
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<{ userText: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const snapshotFingerprint = chatHomeSnapshotFingerprint(snapshot);

  const activeConversation = getActiveChatConversation(session);
  const messages = activeConversation.messages;
  const pending = pendingTurn !== null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pendingTurn]);

  // 刷新后从本地浏览器恢复对话；骑行数据已变化时保留历史、自动开启带最新摘要的新对话
  useEffect(() => {
    const stored = readStoredChatSession();
    if (stored) setSession(isChatSessionStale(stored, snapshot) ? startChatConversation(stored, snapshot) : stored);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSession((current) => isChatSessionStale(current, snapshot) ? startChatConversation(current, snapshot) : current);
  }, [snapshot, snapshotFingerprint]);

  useEffect(() => {
    if (hydrated) storeChatSession(session);
  }, [session, hydrated]);

  // CHAT-14 P1：turn 携带服务端返回的 route/rideAnchor 时记 session_turn 槽位（供后续继承与挂起确认识别）。
  function addReply(userText: string, reply: string | null, source: ChatSessionSummarySource, turn?: { route?: string; rideAnchor?: string }) {
    if (!reply) return;
    const slotTurn = turn && isChatRoute(turn.route)
      ? { route: turn.route, ...(turn.rideAnchor ? { rideAnchor: turn.rideAnchor } : {}) }
      : undefined;
    setSession((current) => appendChatTurn(current, userText, reply, source, slotTurn));
  }

  async function ask(userText: string, source: ChatSessionSummarySource) {
    setPendingTurn({ userText });
    // CHAT-14 P1：携带当前对话白名单摘要请求服务端（指代消解/锚点继承依赖）。
    const summaries = buildChatSessionSummaries(activeConversation);
    const result = await requestChatReply(userText, summaries);
    setPendingTurn(null);
    addReply(userText, result.reply, source, { route: result.route, rideAnchor: result.rideAnchor });
  }

  function startConversation() {
    setSession((current) => startChatConversation(current, snapshot));
    setInput("");
    setHistoryOpen(false);
  }

  function openConversation(id: string) {
    setSession((current) => selectChatConversation(current, id));
    setHistoryOpen(false);
  }

  const quickQuestions = ["当前可以分析哪些数据？", "骑行解读", "水平评估", "训练计划"];

  function askQuickQuestion(label: string) {
    if (pending) return;
    void ask(label, "quick_question");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = input.trim();
    if (!value || pending) return;
    setInput("");
    // CHAT-12 P1：聚合问题由服务端 "aggregate" 路由确定性作答，不再客户端拦截。
    // 2026-10-24 回归修复：不再传本地正则兜底，失败就如实降级（见 CHAT_UNAVAILABLE_REPLY）。
    void ask(value, "typed_input");
  }

  return <section className="chat-home" aria-label="AI 骑行伙伴">
    <header className="topbar">
      <Brand />
      <div className="chat-header-actions">
        <button type="button" className="chat-header-button" onClick={startConversation}>＋ 新对话</button>
        <button type="button" className="chat-header-button" onClick={() => setHistoryOpen((open) => !open)} aria-expanded={historyOpen}>对话记录</button>
      </div>
    </header>

    {historyOpen && <aside className="chat-history" aria-label="对话记录">
      <div className="chat-history-heading"><strong>对话记录</strong><span>当前标签页</span></div>
      <div className="chat-history-list">
        {session.conversations.slice().reverse().map((conversation) => <button
          className={conversation.id === session.activeConversationId ? "active" : ""}
          key={conversation.id}
          type="button"
          onClick={() => openConversation(conversation.id)}
        >
          <span>{conversationTitle(conversation.messages)}</span>
          <small>{conversation.messages.filter((message) => message.role === "user").length} 条提问</small>
        </button>)}
      </div>
      <p className="chat-history-note">对话记录保存在本浏览器本地；骑行数据变化后会自动开始新对话。</p>
    </aside>}

    <dl className="chat-summary" aria-label="最小骑行摘要">
      <div><dt>累计骑行</dt><dd>{snapshot.totalRideCount} 次</dd></div>
      <div><dt>总里程</dt><dd>{snapshot.totalDistanceKm} km</dd></div>
      <div><dt>本周</dt><dd>{snapshot.weekRideCount} 次 · {snapshot.weekDistanceKm} km</dd></div>
    </dl>

    <div className="chat-messages" aria-live="polite">
      {messages.map((message, index) => <MessageBubble key={`${message.role}-${index}-${message.text}`} message={message} />)}
      {pendingTurn && <>
        <article className="chat-message chat-message-user"><p>{pendingTurn.userText}</p></article>
        <ChatPendingReply />
      </>}
      <div ref={messagesEndRef} />
    </div>

    <div className="chat-composer">
      <section className="chat-quick-questions" aria-label="常用问题">
        <div className="chat-question-list">
          {quickQuestions.map((label) => <button key={label} type="button" onClick={() => askQuickQuestion(label)}>{label}</button>)}
        </div>
      </section>

      <form className="chat-input-form" onSubmit={submit}>
        {disclosureOpen && <p className="chat-disclosure-popover" role="note">单次骑行与能力问题调用对话模型（扣子 Workflow，服务端校验并降级）；累计/本周类问题由服务端确定性计算；跨次比较与水平评估属后续能力；对话记录保存在本浏览器。</p>}
        <label className="sr-only" htmlFor="chat-input">输入问题</label>
        <input id="chat-input" value={input} onChange={(event) => setInput(event.target.value)} maxLength={120} placeholder="问问你的骑行伙伴" disabled={pending} />
        <button type="button" className="chat-info-button" aria-label="能力说明" aria-expanded={disclosureOpen} onClick={() => setDisclosureOpen((open) => !open)}><InfoIcon /></button>
        <button type="submit" disabled={!input.trim() || pending}>发送</button>
      </form>
    </div>
  </section>;
}
