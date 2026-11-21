import { isPlatformId } from "../../../src/ux/platform-catalog.ts";
import { resolveOrCreateRequestSession, sessionCookieHeader } from "../../../src/auth/session.ts";
import { getApplicationRepository, type OneLapConnection } from "../../../src/persistence/application-repository.ts";
import { PlatformError, updatePlatform, type PlatformAction } from "../../../src/ux/platform.ts";
import { connectOneLapPilot, getOneLapPilotConnection, syncOneLapPilot } from "../../../src/sync/onelap-sync.ts";

import { oneLapPilotFor } from "../../../src/sync/onelap-access.ts";

export const runtime = "nodejs";

function liveResponse(connection: OneLapConnection | null, headers: HeadersInit) {
  return Response.json({ live: true, platform: connection && {
    status: connection.paused ? "expired" : "connected",
    connectedAt: connection.connectedAt,
    lastSyncAt: connection.lastSyncAt,
    lastAttemptAt: connection.lastAttemptAt,
    retryAt: connection.retryAt,
    error: connection.error,
    result: connection.result,
  } }, { headers });
}

export async function GET(request: Request) {
  try {
    const provider = new URL(request.url).searchParams.get("provider") ?? "garmin";
    if (!isPlatformId(provider)) return Response.json({ error: "未知运动平台" }, { status: 422 });
    const session = resolveOrCreateRequestSession(request);
    const repository = getApplicationRepository();
    const headers = { "Cache-Control": "no-store", ...sessionCookieHeader(session) };
    const config = oneLapPilotFor(session.userId, provider);
    if (config) return liveResponse(await getOneLapPilotConnection(repository, config), headers);
    const profile = await repository.getProfile(session.userId);
    return Response.json({ platform: profile?.ux?.platforms?.[provider] ?? (provider === "garmin" ? profile?.ux?.platform : undefined) ?? null }, { headers });
  } catch { return Response.json({ error: "平台状态暂时无法读取，请重试。" }, { status: 503 }); }
}
export async function POST(request: Request) {
  try {
    const session = resolveOrCreateRequestSession(request);
    const { action, range, scenario, provider = "garmin" } = await request.json();
    if (!isPlatformId(provider) || !["connect", "disconnect", "sync", "retry", "expire", "add-sample"].includes(action) || (range !== undefined && ![7, 30, 90].includes(range))) return Response.json({ error: "无效的同步操作或历史范围。" }, { status: 422 });
    const repository = getApplicationRepository();
    const headers = { "Cache-Control": "no-store", ...sessionCookieHeader(session) };
    const config = oneLapPilotFor(session.userId, provider);
    if (config) {
      if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return Response.json({ error: "无效的请求格式。" }, { status: 415, headers });
      if (action === "connect") return liveResponse(await connectOneLapPilot(repository, config), headers);
      if (action === "disconnect") {
        await repository.setOneLapConnection(session.userId, null);
        return liveResponse(null, headers);
      }
      if (action !== "sync") return Response.json({ error: "无效的顽鹿同步操作。" }, { status: 422, headers });
      const connection = await getOneLapPilotConnection(repository, config);
      if (!connection || connection.paused) throw new PlatformError("请先连接顽鹿。");
      if ((connection.retryAt ?? 0) > Date.now()) return Response.json({ error: "顽鹿限制了请求频率，请稍后重试。" }, { status: 429, headers });
      return liveResponse(await syncOneLapPilot(repository, config), headers);
    }
    const value = await updatePlatform(repository, session.userId, action as PlatformAction, range, scenario, provider);
    return Response.json(value, { headers });
  } catch (error) { return Response.json({ error: error instanceof PlatformError ? error.message : "同步暂时不可用，请重试。" }, { status: error instanceof PlatformError ? 409 : 503 }); }
}
