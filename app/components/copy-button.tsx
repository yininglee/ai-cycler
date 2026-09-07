"use client";

import { useState } from "react";
import { recordDemoEvent } from "./demo-event-client";

export function CopyButton({ text, rideId }: { text: string; rideId: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    recordDemoEvent({ type: "share_copied", rideId });
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return <button className="primary-button" type="button" onClick={copy}>{copied ? "已复制" : "复制分享文案"}</button>;
}
