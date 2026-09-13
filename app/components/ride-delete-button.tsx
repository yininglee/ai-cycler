"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { MoreIcon } from "./icons";

export default function RideDeleteButton({ rideId }: { rideId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击浮窗外部时收起，避免菜单残留。
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  async function remove(): Promise<void> {
    if (busy) return;
    setBusy(true);
    const response = await fetch(`/api/rides/${encodeURIComponent(rideId)}`, { method: "DELETE" });
    if (response.ok) {
      router.push("/import");
      return;
    }
    setBusy(false);
    setOpen(false);
    window.alert("删除失败，请稍后重试");
  }

  return (
    <div className="summary-record-more" ref={rootRef}>
      <button
        type="button"
        className="summary-more-button"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon />
      </button>
      {open && (
        <div className="summary-more-menu" role="menu">
          <button type="button" className="summary-more-delete" role="menuitem" onClick={remove} disabled={busy}>
            {busy ? "正在删除…" : "删除"}
          </button>
        </div>
      )}
    </div>
  );
}
