import { ACCOUNT_COOKIE_NAME, accountCookie, getRequestSession, requestCookie, requiresOidcSession } from "../../../src/auth/session.ts";
import { createAccountSession, deleteAccountIdentity, findAccountCredentials, registerAccount, revokeAccountSession } from "../../../src/auth/account-store.ts";
import { hashAccountPassword, verifyAccountPassword } from "../../../src/auth/account-password.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";
import { createDemoEvent } from "../../../src/observability/demo-events.ts";
import { TrainingPlanStore } from "../../../src/persistence/training-plan-store.ts";
import { ImportRateLimiter } from "../../../src/imports/import-rate-limit.ts";
import { accountFormErrorMessage, accountFormHref, type AccountFormError } from "../../../src/auth/account-form.ts";
import { accountReturnPath } from "../../../src/auth/account-return-path.ts";

export const runtime = "nodejs";
const cacheHeaders = { "Cache-Control": "no-store" };
const authLimiters = globalThis as typeof globalThis & {
  cyclerAccountLimiters?: { overall: ImportRateLimiter; email: ImportRateLimiter };
};
const limits = authLimiters.cyclerAccountLimiters ??= {
  overall: new ImportRateLimiter(40, 60_000),
  email: new ImportRateLimiter(8, 15 * 60_000),
};

function json(value: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(value, { status, headers: { ...cacheHeaders, ...headers } });
}

function sameOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}

function redirectTo(location: string, headers?: Record<string, string>): Response {
  return new Response(null, { status: 303, headers: { ...cacheHeaders, Location: location, ...headers } });
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const isForm = contentType === "application/x-www-form-urlencoded";
  const origin = request.headers.get("origin");
  if ((!isForm && contentType !== "application/json") || !sameOrigin(request)
    || (isForm && request.headers.get("sec-fetch-site") !== "same-origin" && origin !== new URL(request.url).origin)) {
    return json({ error: accountFormErrorMessage("request") }, 403);
  }
  let body: { action?: unknown; email?: unknown; password?: unknown; returnTo?: unknown } = {};
  function reject(error: AccountFormError, status: number, headers?: Record<string, string>) {
    return isForm
      ? redirectTo(accountFormHref(body.returnTo, body.action === "register", error), headers)
      : json({ error: accountFormErrorMessage(error) }, status, headers);
  }
  const maxBytes = isForm ? 12_288 : 4096; // URL encoding can expand non-ASCII fields and the return path.
  if (Number(request.headers.get("content-length")) > maxBytes) return reject("length", 413);
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > maxBytes) return reject("length", 413);
    const data: unknown = isForm ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return reject("request", 400);
    body = data;
  } catch {
    return reject("request", 400);
  }

  if (requiresOidcSession()) return reject("unavailable", 503);
  try {
    const previousToken = requestCookie(request, ACCOUNT_COOKIE_NAME);
    if (body.action === "logout") {
      if (previousToken) revokeAccountSession(previousToken);
      const headers = { "Set-Cookie": accountCookie() };
      return isForm ? redirectTo("/account", headers) : json({ signedIn: false }, 200, headers);
    }
    if (body.action !== "register" && body.action !== "login") return reject("action", 422);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reject("email", 422);
    }
    if (password.length < 12 || Buffer.byteLength(password) > 512) {
      return body.action === "register" ? reject("password", 422) : reject("credentials", 401);
    }
    const overall = limits.overall.check("account");
    const decision = overall.allowed ? limits.email.check(email) : overall;
    if (!decision.allowed) {
      return reject("limited", 429, { "Retry-After": String(decision.retryAfterSeconds) });
    }
    let token: string | null;
    if (body.action === "register") {
      token = registerAccount(email, await hashAccountPassword(password));
      if (!token) return reject("registered", 409);
    } else {
      const account = findAccountCredentials(email);
      if (!await verifyAccountPassword(password, account?.passwordHash) || !account) {
        return reject("credentials", 401);
      }
      token = createAccountSession(account.id);
    }
    if (previousToken) revokeAccountSession(previousToken);
    const headers = { "Set-Cookie": accountCookie(token) };
    return isForm ? redirectTo(accountReturnPath(body.returnTo), headers)
      : json({ signedIn: true }, body.action === "register" ? 201 : 200, headers);
  } catch {
    return reject("unavailable", 503);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "UNAUTHORIZED" }, 403);
  if (requiresOidcSession()) return json({ error: "AUTH_CONFIGURATION_REQUIRED" }, 503);
  const session = getRequestSession(request);
  if (!session) return json({ error: "UNAUTHORIZED" }, 401);
  await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "deletion_requested", attributes: { scope: "account" } }));
  await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "deletion_completed", attributes: { scope: "account" } }));
  await new TrainingPlanStore().deleteOwner(session.userId);
  await getApplicationRepository().deleteAccount(session.userId);
  if (session.accountEmail) deleteAccountIdentity(session.userId);
  const cookie = session.accountEmail ? accountCookie() : "ai-cycling-buddy-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
  return json({ deleted: true }, 200, { "Set-Cookie": cookie });
}
