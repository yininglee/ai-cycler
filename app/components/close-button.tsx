import type { MouseEventHandler } from "react";

export function CloseButton({ label, onClick, autoFocus = false }: {
  label: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  autoFocus?: boolean;
}) {
  return <button type="button" className="dialog-close-button" aria-label={label} onClick={onClick} autoFocus={autoFocus}><span aria-hidden="true">×</span></button>;
}
