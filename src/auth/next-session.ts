import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "./session.ts";

export async function getNextSessionUserId(): Promise<string | null> {
  if (process.env.AUTH_SESSION_MODE === "oidc") return null;
  const value = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!value) return null;
  const request = new Request("http://localhost", { headers: { cookie: `${SESSION_COOKIE_NAME}=${value}` } });
  const { getRequestSession } = await import("./session.ts");
  return getRequestSession(request)?.userId ?? null;
}
