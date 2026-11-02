"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseButton } from "./close-button";

export function SideDrawer({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [present, setPresent] = useState(false);
  const [entered, setEntered] = useState(false);
  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { setMounted(true); }, []);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    if (open && !present) { setPresent(true); return; }
    if (!present) return;
    if (!open) {
      setEntered(false);
      // Also settle when reduced motion or a background tab suppresses events.
      const timer = window.setTimeout(() => setPresent(false), 240);
      return () => window.clearTimeout(timer);
    }
    // Paint the off-screen pose after EVERY hidden -> visible transition.
    // CSS transitions can then reverse mid-flight without replacing animations.
    let nextFrame = 0;
    const frame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => setEntered(true));
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame); };
  }, [open, present]);

  useEffect(() => {
    if (!present) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    const padding = document.body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    const background = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== layerRef.current);
    const inertStates = background.map(node => node.inert);
    background.forEach(node => { node.inert = true; });
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    panelRef.current?.focus({ preventScroll: true });
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []).filter(node => node.getClientRects().length > 0);
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
      background.forEach((node, index) => { node.inert = inertStates[index]; });
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = padding;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [present]);

  if (!mounted) return null;
  return createPortal(<div ref={layerRef} className="chat-drawer-layer" hidden={!present} data-state={entered ? "open" : "closed"}>
    <div className="chat-drawer-scrim" aria-hidden="true" onClick={onClose} />
    <aside ref={panelRef} id="chat-sidebar" className="chat-drawer" role="dialog" aria-modal="true" aria-labelledby="chat-sidebar-title" tabIndex={-1} onTransitionEnd={event => {
      if (event.target === event.currentTarget && event.propertyName === "transform" && !open) setPresent(false);
    }}>
      <div className="chat-drawer-heading"><strong id="chat-sidebar-title">Cycler</strong><CloseButton label="关闭侧边抽屉" onClick={onClose} /></div>
      {children}
    </aside>
  </div>, document.body);
}
