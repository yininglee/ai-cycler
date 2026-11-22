import { accountReturnPath } from "./src/auth/account-return-path.ts";
import { getAccountRequestSession, signInRequiredResponse } from "./src/auth/session.ts";

export function proxy(request: Request): Response | undefined {
  const url = new URL(request.url);
  const { pathname, search } = url;
  const readPage = request.method === "GET" || request.method === "HEAD";
  if (pathname === "/account" && readPage) {
    if (!url.searchParams.has("email") && !url.searchParams.has("password")) return;
    url.searchParams.delete("email");
    url.searchParams.delete("password");
    return new Response(null, { status: 303, headers: {
      Location: url.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    } });
  }
  if (pathname === "/api/account" && request.method === "POST") return;

  const headers = { "Cache-Control": "no-store" };
  try {
    if (getAccountRequestSession(request)) return;
  } catch {
    return Response.json({ error: "AUTH_UNAVAILABLE", message: "账号服务暂不可用，请稍后重试。" }, { status: 503, headers });
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return signInRequiredResponse();
  }

  const login = new URL("/account", url);
  if (pathname !== "/") login.searchParams.set("returnTo", accountReturnPath(pathname + search));
  return new Response(null, { status: 303, headers: { ...headers, Location: login.toString() } });
}

export const config = {
  matcher: ["/((?!_next/static/|_next/image(?:/|$)|_next/(?:webpack-)?hmr(?:/|$)|__nextjs_font/|favicon\\.ico$|icon\\.svg$).*)"],
};
