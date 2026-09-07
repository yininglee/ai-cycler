import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "ai-cycling-buddy-session";
const DEV_SECRET = "ai-cycling-buddy-local-development-secret-v1";
const AUTH_SESSION_MODE = "AUTH_SESSION_MODE";

type SessionPayload = { userId: string; issuedAt: number };

function secret(): string {
  return process.env.SESSION_SECRET || DEV_SECRET;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function encode(payload: SessionPayload): string {
  const value = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${value}.${sign(value)}`;
}

function decode(value: string | null): SessionPayload | null {
  if (!value) return null;
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    return typeof payload.userId === "string" && payload.userId.length > 0 ? payload : null;
  } catch {
    return null;
  }
}

export type RequestSession = { userId: string; setCookie?: string };

export class AuthConfigurationError extends Error {
  readonly code = "AUTH_CONFIGURATION_REQUIRED" as const;
}

function usesOidcSession(): boolean {
  return process.env[AUTH_SESSION_MODE] === "oidc";
}

export function getRequestSession(request: Request): RequestSession | null {
  // An OIDC deployment must replace this development-cookie adapter. Never
  // accept its locally signed cookie as an OIDC identity.
  if (usesOidcSession()) return null;
  const value = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`))?.[1] ?? null;
  const payload = decode(value);
  return payload ? { userId: payload.userId } : null;
}

/** Development-only signed cookie session. This is not a production OIDC session. */
export function resolveOrCreateRequestSession(request: Request): RequestSession {
  if (usesOidcSession()) {
    throw new AuthConfigurationError("OIDC session adapter is not configured");
  }
  const existing = getRequestSession(request);
  if (existing) return existing;
  const userId = `local-user-${crypto.randomUUID()}`;
  const value = encode({ userId, issuedAt: Date.now() });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return { userId, setCookie: `${SESSION_COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}` };
}

export function authSessionMode(): "development" | "oidc" {
  return usesOidcSession() ? "oidc" : "development";
}

export function requiresOidcSession(): boolean {
  return usesOidcSession();
}

export function sessionCookieHeader(session: RequestSession): Record<string, string> {
  return session.setCookie ? { "Set-Cookie": session.setCookie } : {};
}
