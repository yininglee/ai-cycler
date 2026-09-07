"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  chatQuickQuestions,
  replyToChatInput,
  replyToQuickQuestion,
  type ChatHomeSnapshot,
  type ChatMessage,
} from "../../src/chat/chat-home.ts";
import {
  appendChatTurn,
  chatHomeSnapshotFingerprint,
  createChatSession,
  getActiveChatConversation,
  isChatSessionStale,
  selectChatConversation,
  startChatConversation,
} from "../../src/chat/chat-session.ts";

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const snapshotFingerprint = chatHomeSnapshotFingerprint(snapshot);

  const activeConversation = getActiveChatConversation(session);
  const messages = activeConversation.messages;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    setSession((current) => isChatSessionStale(current, snapshot) ? createChatSession(snapshot) : current);
  }, [snapshot, snapshotFingerprint]);

  function addReply(userText: string, reply: string | null, source: "quick_question" | "typed_input") {
    if (!reply) return;
    setSession((current) => appendChatTurn(current, userText, reply, source));
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

  function askQuickQuestion(id: Parameters<typeof replyToQuickQuestion>[0], label: string) {
    addReply(label, replyToQuickQuestion(id, snapshot), "quick_question");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = input.trim();
    if (!value) return;
    addReply(value, replyToChatInput(value, snapshot), "typed_input");
    setInput("");
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
      <p className="chat-history-note">记录仅保留在当前标签页；刷新或骑行摘要变化后不会恢复。</p>
    </aside>}

    <dl className="chat-summary" aria-label="最小骑行摘要">
      <div><dt>累计骑行</dt><dd>{snapshot.totalRideCount} 次</dd></div>
      <div><dt>总里程</dt><dd>{snapshot.totalDistanceKm} km</dd></div>
      <div><dt>本周</dt><dd>{snapshot.weekRideCount} 次 · {snapshot.weekDistanceKm} km</dd></div>
    </dl>

    <div className="chat-thread" aria-live="polite">
      {messages.map((message, index) => <MessageBubble key={`${message.role}-${index}-${message.text}`} message={message} />)}
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
        <input id="chat-input" value={input} onChange={(event) => setInput(event.target.value)} maxLength={120} placeholder="问问你的骑行摘要" />
        <button type="submit" disabled={!input.trim()}>发送</button>
        <p className="chat-disclosure">本页不调用模型；记录仅在当前标签页临时保留。</p>
      </form>
    </div>
  </section>;
}
