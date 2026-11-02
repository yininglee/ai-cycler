"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

type StackCard = { id: string; content: ReactNode };

export function RideCardStack({ cards }: { cards: StackCard[] }) {
  if (cards.length < 2) return cards[0]?.content ?? null;
  return <CardDeck key={JSON.stringify(cards.map(card => card.id))} cards={cards} />;
}

function CardDeck({ cards }: { cards: StackCard[] }) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [dragY, setDragY] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const indexRef = useRef(index);
  const gesture = useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);
  const hintId = useId();

  function switchCard(next: number) {
    const target = Math.max(0, Math.min(cards.length - 1, next));
    if (target === indexRef.current) return;
    setDirection(target > indexRef.current ? 1 : -1);
    indexRef.current = target;
    setIndex(target);
  }

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    let amount = 0;
    let lastEventAt = 0;
    let switchedAt = 0;
    function wheel(event: WheelEvent) {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || !event.deltaY || event.ctrlKey) return;
      const now = Date.now();
      const step = event.deltaY > 0 ? 1 : -1;
      const next = indexRef.current + step;
      // At either end, scrolling continues through the conversation normally.
      if (next < 0 || next >= cards.length) return;
      event.preventDefault();
      event.stopPropagation();
      if (now - lastEventAt > 160 || Math.sign(amount) !== step) amount = 0;
      lastEventAt = now;
      if (now - switchedAt < 400) return;
      amount += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element!.clientHeight : 1);
      if (Math.abs(amount) < 40) return;
      switchCard(next);
      switchedAt = now;
      amount = 0;
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [cards.length]);

  return <section className="ride-card-stack" aria-label={`${cards.length} 条骑行记录`} aria-roledescription="卡片堆叠">
    <div className="ride-card-stack-stage" ref={stage} tabIndex={0} aria-describedby={hintId}
      style={{ "--ride-stack-entry-y": `${direction * 24}px` } as CSSProperties}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const target = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? cards.length - 1 : null;
        if (target !== null) { event.preventDefault(); switchCard(target); }
      }}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        suppressClick.current = false;
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
      }}
      onPointerMove={event => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const dy = event.clientY - current.y;
        if (!current.dragging && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(event.clientX - current.x)) {
          current.dragging = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        if (current.dragging) {
          suppressClick.current = true;
          setDragY(Math.max(-64, Math.min(64, dy * 0.45)));
        }
      }}
      onPointerUp={event => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const dy = event.clientY - current.y;
        if (current.dragging && Math.abs(dy) >= 40) switchCard(indexRef.current + (dy < 0 ? 1 : -1));
        gesture.current = null;
        setDragY(0);
      }}
      onPointerCancel={() => { gesture.current = null; suppressClick.current = false; setDragY(0); }}
      onClickCapture={event => {
        if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
      }}>
      {cards.length > 2 && <span className="ride-card-stack-back ride-card-stack-back-far" aria-hidden="true" />}
      <span className="ride-card-stack-back" aria-hidden="true" />
      {cards.map((card, position) => <div key={card.id}
        className={`ride-card-stack-card${position === index ? " is-active" : ""}`}
        aria-hidden={position !== index} inert={position !== index}
        role="group" aria-roledescription="卡片" aria-label={`第 ${position + 1} 条，共 ${cards.length} 条`}
        style={position === index ? { translate: `0 ${dragY}px` } : undefined}>
        {card.content}
      </div>)}
    </div>
    <span id={hintId} className="sr-only">上下滑动或使用上下方向键切换骑行记录</span>
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">第 {index + 1} 条，共 {cards.length} 条</span>
  </section>;
}
