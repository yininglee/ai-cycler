"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

import { InterpretationView } from "./interpretation-view";

/**
 * Bottom-sheet drawer for the AI ride interpretation.
 *
 * Pure component: mounted/unmounted by the caller (`RideAiAnalysis`) based on
 * local state — no route involved. Renders `InterpretationView` inside a
 * fixed-position sheet that slides up from the bottom on mobile and centers
 * as a modal on desktop. Closes via the X button, the backdrop, or the ESC
 * key (all funnel into `onClose`). Body scroll is locked while open.
 */
export function InterpretationSheet({
  rideId,
  title,
  dateLabel,
  demoFallback,
  onClose,
}: {
  rideId: string;
  title: string;
  dateLabel?: string;
  demoFallback?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarGap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarGap > 0) document.body.style.paddingRight = `${scrollbarGap}px`;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, []);

  // 用 portal 挂到 body：抽屉原本渲染在 .summary-sheet（z-index:2）内部，该祖先
  // 会形成层叠上下文，把抽屉自身的 z-index 限制在局部层，因而压不住 fixed 的
  // 顶部/底部导航。挂到 body 后与导航同处根层叠上下文，z-index:80 即可正确覆盖。
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="interpretation-sheet-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="interpretation-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="AI 骑行解读"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="interpretation-sheet-header">
          <span className="interpretation-sheet-handle" aria-hidden="true" />
          <p className="kicker interpretation-sheet-kicker">RIDE INSIGHT</p>
          <button
            type="button"
            className="interpretation-sheet-close"
            onClick={onClose}
            aria-label="关闭 AI 解读"
          >
            ×
          </button>
        </header>
        <div className="interpretation-sheet-body">
          <InterpretationView rideId={rideId} title={title} dateLabel={dateLabel} demoFallback={demoFallback} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
