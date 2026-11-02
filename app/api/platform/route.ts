import { isPlatformId } from "../../../src/ux/platform-catalog.ts";
import { resolveOrCreateRequestSession, sessionCookieHeader } from "../../../src/auth/session.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";
import { PlatformError, updatePlatform, type PlatformAction } from "../../../src/ux/platform.ts";

export async function GET(request: Request) {
  try {
    const provider = new URL(request.url).searchParams.get("provider") ?? "garmin";
    if (!isPlatformId(provider)) return Response.json({ error: "未知运动平台" }, { status: 422 });
    const session = resolveOrCreateRequestSession(request);
    const profile = await getApplicationRepository().getProfile(session.userId);
    return Response.json({ platform: profile?.ux?.platforms?.[provider] ?? (provider === "garmin" ? profile?.ux?.platform : undefined) ?? null }, { headers: { "Cache-Control": "no-store", ...sessionCookieHeader(session) } });
  } catch { return Response.json({ error: "平台状态暂时无法读取，请重试。" }, { status: 503 }); }
}
export async function POST(request: Request) {
  try {
    const session = resolveOrCreateRequestSession(request);
    const { action, range, scenario, provider = "garmin" } = await request.json();
    if (!isPlatformId(provider) || !["connect", "disconnect", "sync", "retry", "expire", "add-sample"].includes(action) || (range !== undefined && ![7, 30, 90].includes(range))) return Response.json({ error: "无效的同步操作或历史范围。" }, { status: 422 });
    const value = await updatePlatform(getApplicationRepository(), session.userId, action as PlatformAction, range, scenario, provider);
    return Response.json(value, { headers: { "Cache-Control": "no-store", ...sessionCookieHeader(session) } });
  } catch (error) { return Response.json({ error: error instanceof PlatformError ? error.message : "同步暂时不可用，请重试。" }, { status: error instanceof PlatformError ? 409 : 503 }); }
}
