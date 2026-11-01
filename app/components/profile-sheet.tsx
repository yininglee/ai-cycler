"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseButton } from "./close-button";
import ProfileEditor from "./profile-editor";

export function BottomSheet({ open, title, onClose, children }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const [mounted, setMounted] = useState(false);
  const [present, setPresent] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => { if (open) setPresent(true); }, [open]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!present || !panel) return;
    // Fit the contents once, before the entering frame is painted. Keep that
    // height for this opening so loading, validation and focus cannot bounce it.
    panel.style.height = "auto";
    panel.style.height = `${panel.getBoundingClientRect().height}px`;
  }, [present]);

  useEffect(() => {
    if (!present) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    // Focus the stationary panel without asking the browser to scroll to an
    // animating button. The portal also keeps it outside the chat scroll area.
    panelRef.current?.focus({ preventScroll: true });
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault(); last?.focus({ preventScroll: true });
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) {
        event.preventDefault(); first?.focus({ preventScroll: true });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [present]);

  if (!mounted) return null;
  // Keep the form mounted while hidden so closing and reopening retains drafts.
  return createPortal(<div className="profile-sheet-layer" hidden={!present} data-state={open ? "open" : "closing"} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panelRef} className="profile-sheet-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onAnimationEnd={event => {
      if (event.target === event.currentTarget && event.animationName === "profileSheetExit" && !open) setPresent(false);
    }}>
      <header className="profile-sheet-header">
        <span className="profile-sheet-handle" aria-hidden="true" />
        <h2 id={titleId}>{title}</h2>
        <CloseButton label={`关闭${title}`} onClick={onClose} />
      </header>
      <div className="profile-sheet-content">{children}</div>
    </section>
  </div>, document.body);
}

export function ProfileSheet({ open, onClose, onSaved }: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  return <BottomSheet open={open} title="完善个人资料" onClose={onClose}>
    <ProfileEditor formOnly onSaved={onSaved} />
  </BottomSheet>;
}
