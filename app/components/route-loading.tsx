export type NavKey = "today" | "rides" | "partner" | "profile";

export function RouteProgress({ label, inline = false }: { label: string; inline?: boolean }) {
  return <span className={`route-progress${inline ? " route-progress-inline" : ""}`} role="progressbar" aria-label={label} />;
}
