import { headers } from "next/headers";
import { getAccountRequestSession } from "./session.ts";

export async function getNextSession() {
  const cookie = (await headers()).get("cookie");
  return cookie ? getAccountRequestSession(new Request("http://localhost", { headers: { cookie } })) : null;
}

export async function getNextSessionUserId(): Promise<string | null> {
  return (await getNextSession())?.userId ?? null;
}
