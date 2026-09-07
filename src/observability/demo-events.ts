import { createHmac } from "node:crypto";

export const DEMO_EVENT_TYPES = [
  "import_started",
  "import_completed",
  "ai_requested",
  "ai_completed",
  "ai_degraded",
  "chat_requested",
  "chat_completed",
  "chat_degraded",
  "b0_visible",
  "evidence_viewed",
  "feedback_submitted",
  "share_previewed",
  "share_copied",
  "deletion_requested",
  "deletion_completed",
] as const;

export type DemoEventType = typeof DEMO_EVENT_TYPES[number];
export type DemoFeedback = "helpful" | "not_helpful";
export type DemoShareTemplate = "dark" | "light";
export type DemoAiFallbackCode = "AI_DISABLED" | "AI_NOT_CONFIGURED" | "DATA_NOT_ELIGIBLE" | "AI_TIMEOUT" | "PROVIDER_ERROR" | "REPAIR_FAILED";

export type DemoEvent = {
  eventId: string;
  type: DemoEventType;
  occurredAt: string;
  requestRef?: string;
  rideRef?: string;
  attributes?: Record<string, string>;
};

export type DemoEventInput = {
  type: "b0_visible";
  rideId: string;
  code: DemoAiFallbackCode;
} | {
  type: "evidence_viewed" | "share_copied";
  rideId: string;
} | {
  type: "feedback_submitted";
  rideId: string;
  feedback: DemoFeedback;
} | {
  type: "share_previewed";
  rideId: string;
  template: DemoShareTemplate;
};

type ServerEventInput = {
  type: Exclude<DemoEventType, DemoEventInput["type"]>;
  rideId?: string;
  requestId?: string;
  attributes?: Record<string, string>;
};

const FALLBACK_CODES = new Set<DemoAiFallbackCode>(["AI_DISABLED", "AI_NOT_CONFIGURED", "DATA_NOT_ELIGIBLE", "AI_TIMEOUT", "PROVIDER_ERROR", "REPAIR_FAILED"]);
const eventTypes = new Set<string>(DEMO_EVENT_TYPES);

function eventSecret(): string {
  return process.env.DEMO_EVENT_HASH_SECRET || process.env.SESSION_SECRET || "ai-cycling-buddy-demo-event-secret-v1";
}

export function demoRideReference(rideId: string): string {
  return createHmac("sha256", eventSecret()).update(`ride:${rideId}`).digest("base64url").slice(0, 20);
}

export function demoRequestReference(requestId: string): string {
  return createHmac("sha256", eventSecret()).update(`request:${requestId}`).digest("base64url").slice(0, 20);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function parseDemoEventInput(value: unknown): DemoEventInput | null {
  if (!isObject(value) || typeof value.type !== "string" || !eventTypes.has(value.type)) return null;
  if (typeof value.rideId !== "string" || value.rideId.length === 0 || value.rideId.length > 128) return null;

  if (value.type === "b0_visible" && hasOnlyKeys(value, ["type", "rideId", "code"]) && typeof value.code === "string" && FALLBACK_CODES.has(value.code as DemoAiFallbackCode)) {
    return { type: value.type, rideId: value.rideId, code: value.code as DemoAiFallbackCode };
  }
  if ((value.type === "evidence_viewed" || value.type === "share_copied") && hasOnlyKeys(value, ["type", "rideId"])) {
    return { type: value.type, rideId: value.rideId };
  }
  if (value.type === "feedback_submitted" && hasOnlyKeys(value, ["type", "rideId", "feedback"]) && (value.feedback === "helpful" || value.feedback === "not_helpful")) {
    return { type: value.type, rideId: value.rideId, feedback: value.feedback };
  }
  if (value.type === "share_previewed" && hasOnlyKeys(value, ["type", "rideId", "template"]) && (value.template === "dark" || value.template === "light")) {
    return { type: value.type, rideId: value.rideId, template: value.template };
  }
  return null;
}

export function createDemoEvent(input: DemoEventInput | ServerEventInput): DemoEvent {
  const attributes: Record<string, string> = "attributes" in input ? (input.attributes ?? {}) :
    input.type === "b0_visible" ? { code: input.code } :
      input.type === "feedback_submitted" ? { feedback: input.feedback } :
        input.type === "share_previewed" ? { template: input.template } : {};
  return {
    eventId: crypto.randomUUID(),
    type: input.type,
    occurredAt: new Date().toISOString(),
    ...(typeof input === "object" && "requestId" in input && input.requestId ? { requestRef: demoRequestReference(input.requestId) } : {}),
    ...(input.rideId ? { rideRef: demoRideReference(input.rideId) } : {}),
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
  };
}
