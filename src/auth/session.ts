import { createHmac, timingSafeEqual } from "node:crypto";
import { ACCOUNT_SESSION_SECONDS, findSessionAccount } from "./account-store.ts";

export const SESSION_COOKIE_NAME = "ai-cycling-buddy-session";
export const ACCOUNT_COOKIE_NAME = "cycler-account";
const DEV_SECRET = "ai-cycling-buddy-local-development-secret-v1";
const AUTH_SESSION_MODE = "AUTH_SESSION_MODE";
const SESSION_COOKIE_SECURE = "SESSION_COOKIE_SECURE";
const INSECURE_COOKIE_VALUES = new Set(["0", "false", "off", "no"]);

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

export type RequestSession = { userId: string; setCookie?: string; accountEmail?: string };

export class AuthConfigurationError extends Error {
  readonly code = "AUTH_CONFIGURATION_REQUIRED" as const;
}

export class AccountSessionExpiredError extends Error {
  readonly code = "UNAUTHORIZED" as const;
}

export function signInRequiredResponse(): Response {
  return Response.json({ error: "UNAUTHORIZED", message: "请先登录 Cycler。" }, {
    status: 401, headers: { "Cache-Control": "no-store" },
  });
}

function usesOidcSession(): boolean {
  return process.env[AUTH_SESSION_MODE] === "oidc";
}

export function getAccountRequestSession(request: Request): (RequestSession & { accountEmail: string }) | null {
  if (usesOidcSession()) return null;
  const token = requestCookie(request, ACCOUNT_COOKIE_NAME);
  const account = token ? findSessionAccount(token) : null;
  return account ? { userId: account.id, accountEmail: account.email } : null;
}

export function getRequestSession(request: Request): RequestSession | null {
  if (usesOidcSession()) return null;
  if (requestCookie(request, ACCOUNT_COOKIE_NAME)) return getAccountRequestSession(request);
  const payload = decode(requestCookie(request, SESSION_COOKIE_NAME));
  // Legacy guest cookies can only identify generated guest IDs.
  return payload?.userId.startsWith("local-user-") ? { userId: payload.userId } : null;
}

export function requestCookie(request: Request, name: string): string | null {
  return request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] ?? null;
}

export function accountCookie(token = ""): string {
  return `${ACCOUNT_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token ? ACCOUNT_SESSION_SECONDS : 0}${sessionCookieSecureSuffix()}`;
}

/**
 * 会话 cookie 的 `Secure` 标记。
 * 默认：生产环境开启、开发环境关闭。
 * 局域网内以纯 HTTP 演示（如 http://192.168.x.x:3000）时，浏览器会丢弃带
 * `Secure` 的 cookie，导致会话无法保持；此时可显式设 `SESSION_COOKIE_SECURE=0` 关闭。
 */
function sessionCookieSecureSuffix(): string {
  const override = process.env[SESSION_COOKIE_SECURE]?.trim().toLowerCase();
  const secure = override ? !INSECURE_COOKIE_VALUES.has(override) : process.env.NODE_ENV === "production";
  return secure ? "; Secure" : "";
}

/** Development-only signed cookie session. This is not a production OIDC session. */
export function resolveOrCreateRequestSession(request: Request): RequestSession {
  if (usesOidcSession()) {
    throw new AuthConfigurationError("OIDC session adapter is not configured");
  }
  const existing = getRequestSession(request);
  if (existing) return existing;
  if (requestCookie(request, ACCOUNT_COOKIE_NAME)) throw new AccountSessionExpiredError("Cycler sign-in required");
  const userId = `local-user-${crypto.randomUUID()}`;
  const value = encode({ userId, issuedAt: Date.now() });
  const secure = sessionCookieSecureSuffix();
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
