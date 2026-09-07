export type DemoEventClientInput =
  | { type: "b0_visible"; rideId: string; code: "AI_DISABLED" | "AI_NOT_CONFIGURED" | "DATA_NOT_ELIGIBLE" | "AI_TIMEOUT" | "PROVIDER_ERROR" | "REPAIR_FAILED" }
  | { type: "evidence_viewed" | "share_copied"; rideId: string }
  | { type: "feedback_submitted"; rideId: string; feedback: "helpful" | "not_helpful" }
  | { type: "share_previewed"; rideId: string; template: "dark" | "light" };

export function recordDemoEvent(input: DemoEventClientInput): void {
  void fetch("/api/demo-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    keepalive: true,
  }).catch(() => undefined);
}
