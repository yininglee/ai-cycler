import type { ReactNode } from "react";
import { CheckIcon, InfoIcon } from "./icons";

/** Compact, non-interactive state label shared by plans, records and profiles. */
export function StatusBadge({ children, tone = "neutral" }: {
  children: ReactNode;
  tone?: "neutral" | "pending" | "active" | "error";
}) {
  return <span className={`ui-status-badge ui-status-${tone}`}>
    {tone === "active" ? <CheckIcon /> : tone === "pending" ? <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg> : <InfoIcon />}
    <span>{children}</span>
  </span>;
}
