"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CloseButton } from "./close-button";
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
  engine,
  onClose,
}: {
  rideId: string;
  title: string;
  dateLabel?: string;
  demoFallback?: string;
  engine?: "v2";
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState(() => {
    if (demoFallback) return demoFallback;
    if (typeof window === "undefined") return "real";
    const saved = sessionStorage.getItem("cycler-insight-preview");
    return saved && ["loading", "error", "b0"].includes(saved) ? saved : "real";
  });
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    return () => { previous?.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], select, [tabindex="0"]') ?? []);
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
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
        ref={panelRef}
        tabIndex={-1}
        className="interpretation-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="AI 骑行解读"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="interpretation-sheet-header">
          <span className="interpretation-sheet-handle" aria-hidden="true" />
          <p className="kicker interpretation-sheet-kicker">RIDE INSIGHT</p>
          <CloseButton label="关闭深度解读" onClick={onClose} />
        </header>
        <div className="interpretation-sheet-body">
          {preview !== "real" && <p className="ux-meta" role="note">解读状态演示 · 未请求模型</p>}
          {preview === "loading" || preview === "error" ? <section className="ux-card">
            <p className="kicker">{dateLabel}</p><h2>{title}</h2>
            {preview === "loading" ? <p role="status"><span className="spinner" />正在生成解读…（状态演示）</p> : <div role="alert"><h3>解读生成失败</h3><p>模拟服务暂时不可用，当前记录已保留。</p><button className="primary-button" onClick={() => setPreview("b0")}>重试解读（演示）</button></div>}
          </section> : <InterpretationView rideId={rideId} title={title} dateLabel={dateLabel} demoFallback={preview === "b0" ? "b0" : undefined} engine={engine} previewOnly={preview === "b0"} />}

        </div>
      </div>
    </div>,
    document.body,
  );
}
