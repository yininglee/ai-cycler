"use client";

import { useEffect, useState } from "react";

/** Reveal a validated reply progressively; stored/history replies stay fully visible. */
export function ChatReplyText({ text, reveal, onComplete, onProgress }: {
  text: string;
  reveal: boolean;
  onComplete: () => void;
  onProgress: () => void;
}) {
  const [visible, setVisible] = useState(reveal ? 0 : Array.from(text).length);
  useEffect(() => {
    const characters = Array.from(text);
    if (!reveal || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(characters.length);
      if (reveal) onComplete();
      return;
    }
    setVisible(0);
    let frame = 0;
    const started = performance.now();
    const duration = Math.min(6000, Math.max(350, characters.length / 75 * 1000));
    function tick(now: number) {
      const count = Math.min(characters.length, Math.ceil((now - started) / duration * characters.length));
      setVisible(count);
      onProgress();
      if (count < characters.length) frame = requestAnimationFrame(tick);
      else onComplete();
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, reveal, onComplete, onProgress]);
  return <p className={reveal ? "chat-reply-text is-revealing" : "chat-reply-text"}>{reveal ? Array.from(text).slice(0, visible).join("") : text}</p>;
}
