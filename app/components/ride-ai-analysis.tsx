"use client";

import { useState } from "react";

import { InterpretationSheet } from "./interpretation-sheet";

/**
 * Compact entry card for the AI ride interpretation drawer.
 *
 * Client component owning the open/close state: clicking the entry mounts the
 * `InterpretationSheet` (bottom-sheet on mobile / centered modal on desktop)
 * in place over the detail page — no route navigation, per the Keep-style
 * pull-up drawer interaction. The sheet unmounts on close; the underlying
 * `InterpretationView` reads verified existing results through the server
 * cache so each opening rechecks the record and current interpretation inputs.
 */
export function RideAiAnalysis({
  rideId,
  title,
  dateLabel,
  demoFallback,
}: {
  rideId: string;
  title: string;
  dateLabel?: string;
  demoFallback?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <section className="ride-ai-entry" aria-label="AI 骑行解读">
        <div>
          <p className="kicker">RIDE INSIGHT</p>
          <h2>想知道这次骑得怎么样？</h2>
          <p>基于本次记录中的可靠证据生成解读、证据图表与限制说明。</p>
        </div>
        <button
          type="button"
          className="ride-ai-button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          查看深度解读
        </button>
      </section>
      {open && (
        <InterpretationSheet
          rideId={rideId}
          title={title}
          dateLabel={dateLabel}
          demoFallback={demoFallback}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
