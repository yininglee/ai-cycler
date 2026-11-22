import { ACCOUNT_COOKIE_NAME, getRequestSession, requestCookie } from "../../../../../src/auth/session.ts";
import { getApplicationRepository } from "../../../../../src/persistence/application-repository.ts";
import { readXingzheConfig } from "../../../../../src/sync/xingzhe-client.ts";
import { completeXingzheAuthorization } from "../../../../../src/sync/xingzhe-sync.ts";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const config = readXingzheConfig();
  let result: { status: string; returnQuery?: string } = { status: "invalid" };
  try {
    const session = getRequestSession(request);
    const sessionToken = requestCookie(request, ACCOUNT_COOKIE_NAME);
    if (config && session?.accountEmail && sessionToken) {
      result = await completeXingzheAuthorization(getApplicationRepository(), session.userId, config, sessionToken,
        url.searchParams.get("state") ?? "", url.searchParams.get("code"), url.searchParams.has("error"));
    }
  } catch {
    result = { status: "failed" };
  }
  const query = new URLSearchParams(result.returnQuery);
  query.set("oauth", result.status);
  return new Response(null, { status: 303, headers: {
    Location: `/connections/xingzhe?${query}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  } });
}
