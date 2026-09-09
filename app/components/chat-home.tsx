"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  chatQuickQuestions,
  replyToChatInput,
  replyToQuickQuestion,
  type ChatHomeSnapshot,
  type ChatMessage,
  type ChatQuickQuestionId,
} from "../../src/chat/chat-home.ts";
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
async function requestChatReply(text: string, summaries: ChatSessionSummary[], fallback: string | null): Promise<{ reply: string | null; route?: string; rideAnchor?: string }> {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(summaries.length ? { text, summaries } : { text }),
    });
    if (!response.ok) return { reply: fallback };
    const payload: unknown = await response.json();
    const record = payload as { reply?: unknown; rideAnchor?: unknown; decision?: { route?: unknown } } | null;
    const reply = record?.reply;
    const rideAnchor = record?.rideAnchor;
    const route = record?.decision?.route;
    return {
      reply: typeof reply === "string" && reply.trim() ? reply : fallback,
      ...(isChatRoute(route) ? { route } : {}),
      ...(typeof rideAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rideAnchor) ? { rideAnchor } : {}),
    };
  } catch {
    return { reply: fallback };
  }
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

  async function ask(userText: string, fallback: string | null, source: ChatSessionSummarySource) {
    setPendingTurn({ userText });
    // CHAT-14 P1：携带当前对话白名单摘要请求服务端（指代消解/锚点继承依赖）。
    const summaries = buildChatSessionSummaries(activeConversation);
    const result = await requestChatReply(userText, summaries, fallback);
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

  function askQuickQuestion(id: ChatQuickQuestionId, label: string) {
    if (pending) return;
    // 聚合类快捷问题（总量/本周/最近日期）本页确定性回答；capabilities 走真实模型链路。
    // 客户端直答轮 route 记 aggregate（不携带锚点）。
    if (id !== "capabilities") {
      addReply(label, replyToQuickQuestion(id, snapshot), "quick_question", { route: "aggregate" });
      return;
    }
    void ask(label, replyToQuickQuestion(id, snapshot), "quick_question");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = input.trim();
    if (!value || pending) return;
    setInput("");
    // CHAT-12 P1：聚合问题由服务端 "aggregate" 路由确定性作答，不再客户端拦截。
    void ask(value, replyToChatInput(value, snapshot), "typed_input");
  }

  return <section className="chat-home" aria-label="AI 骑行伙伴">
    <header className="chat-home-header">
      <div><p className="kicker">LOCAL DEMO</p><h1>AI 骑行伙伴</h1></div>
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

    <div className="chat-thread" aria-live="polite">
      {messages.map((message, index) => <MessageBubble key={`${message.role}-${index}-${message.text}`} message={message} />)}
      {pendingTurn && <>
        <article className="chat-message chat-message-user"><p>{pendingTurn.userText}</p></article>
        <article className="chat-message chat-message-assistant"><span className="chat-message-label">AI 伙伴</span><p>正在查询……</p></article>
      </>}
      <div ref={messagesEndRef} />
    </div>

    <div className="chat-composer">
      <section className="chat-quick-questions" aria-label="常用问题">
        <div className="chat-question-list">
          {chatQuickQuestions().map((question) => <button key={question.id} type="button" onClick={() => askQuickQuestion(question.id, question.label)}>{question.label}</button>)}
        </div>
      </section>

      <form className="chat-input-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="chat-input">输入问题</label>
        <input id="chat-input" value={input} onChange={(event) => setInput(event.target.value)} maxLength={120} placeholder="问问你的骑行伙伴" disabled={pending} />
        <button type="submit" disabled={!input.trim() || pending}>发送</button>
        <p className="chat-disclosure">单次骑行与能力问题调用对话模型（扣子 Workflow，服务端校验并降级）；累计/本周类问题由服务端确定性计算；跨次比较与水平评估属后续能力；对话记录保存在本浏览器。</p>
      </form>
    </div>
  </section>;
}
