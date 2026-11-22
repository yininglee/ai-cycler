import { isPlatformId, platformInfo } from "../../../src/ux/platform-catalog.ts";
import { ACCOUNT_COOKIE_NAME, requestCookie, resolveOrCreateRequestSession, sessionCookieHeader } from "../../../src/auth/session.ts";
import { getApplicationRepository, type OneLapConnection } from "../../../src/persistence/application-repository.ts";
import { PlatformError, updatePlatform, type PlatformAction } from "../../../src/ux/platform.ts";
import { connectOneLapPilot, disconnectOneLapPilot, getOneLapPilotConnection, syncOneLapPilot } from "../../../src/sync/onelap-sync.ts";

import { oneLapPilotFor } from "../../../src/sync/onelap-access.ts";
import { readXingzheSetup } from "../../../src/sync/xingzhe-client.ts";
import { disconnectXingzhe, startXingzheAuthorization, syncXingzhe } from "../../../src/sync/xingzhe-sync.ts";
import { ManualSyncInProgressError } from "../../../src/sync/manual-sync-runs.ts";
import { isConversationId } from "../../../src/chat/chat-import.ts";

export const runtime = "nodejs";

function rateLimited(name: string, retryAt: number | undefined, headers: Record<string, string>) {
  const remaining = Math.ceil(((retryAt ?? 0) - Date.now()) / 1000);
  if (remaining <= 0) return null;
  return Response.json({ error: `${name}限制了请求频率，请稍后重试。` }, {
    status: 429, headers: { ...headers, "Retry-After": String(remaining) },
  });
}

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
    if (provider === "xingzhe") {
      const setup = readXingzheSetup();
      if (setup.config) {
        if (session.accountEmail) return liveResponse(await repository.getXingzheConnection(session.userId), headers);
        return Response.json({ fileOnly: true, requiresAccount: true, platform: null }, { headers });
      }
      if (session.accountEmail) return Response.json({ fileOnly: true, syncUnavailable: setup.issue, platform: null }, { headers });
    }
    if (session.accountEmail) return Response.json({ fileOnly: true, platform: null }, { headers });
    const profile = await repository.getProfile(session.userId);
    return Response.json({ platform: profile?.ux?.platforms?.[provider] ?? (provider === "garmin" ? profile?.ux?.platform : undefined) ?? null }, { headers });
  } catch { return Response.json({ error: "平台状态暂时无法读取，请重试。" }, { status: 503 }); }
}
export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if ((site && !["same-origin", "none"].includes(site)) || request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return Response.json({ error: "无效的请求格式。" }, { status: 415 });
  }
  try {
    const session = resolveOrCreateRequestSession(request);
    const { action, range, scenario, provider = "garmin", from, conversationId } = await request.json();
    const reimportDeleted = provider === "xingzhe" && action === "reimport-deleted";
    if (!isPlatformId(provider) || (!reimportDeleted && !["connect", "disconnect", "sync", "retry", "expire", "add-sample"].includes(action)) || (range !== undefined && ![7, 30, 90].includes(range))) return Response.json({ error: "无效的同步操作或历史范围。" }, { status: 422 });
    const repository = getApplicationRepository();
    const headers = { "Cache-Control": "no-store", ...sessionCookieHeader(session) };
    const config = oneLapPilotFor(session.userId, provider);
    if (config) {
      if (action === "connect") return liveResponse(await connectOneLapPilot(repository, config), headers);
      if (action === "disconnect") {
        await disconnectOneLapPilot(repository, session.userId);
        return liveResponse(null, headers);
      }
      if (action !== "sync") return Response.json({ error: "无效的顽鹿同步操作。" }, { status: 422, headers });
      const connection = await getOneLapPilotConnection(repository, config);
      if (!connection || connection.paused) throw new PlatformError("请先连接顽鹿。");
      return rateLimited("顽鹿", connection.retryAt, headers) ?? liveResponse(await syncOneLapPilot(repository, config), headers);
    }
    if (provider === "xingzhe") {
      const setup = readXingzheSetup();
      if (reimportDeleted && !session.accountEmail) return Response.json({ error: "请先登录 Cycler。" }, { status: 401, headers });
      if (session.accountEmail && action === "disconnect") {
        await disconnectXingzhe(repository, session.userId);
        return liveResponse(null, headers);
      }
      if (setup.config) {
        const sessionToken = requestCookie(request, ACCOUNT_COOKIE_NAME);
        if (!session.accountEmail || !sessionToken) return Response.json({ error: "请先登录 Cycler。" }, { status: 401, headers });
        if (action === "connect") {
          const browserUrl = URL.parse(request.headers.get("origin") ?? request.url);
          if (browserUrl?.hostname !== new URL(setup.config.redirectUri).hostname) {
            const connectionUrl = new URL("/connections/xingzhe", setup.config.redirectUri);
            if (from === "import" || from === "profile" || from === "chat") connectionUrl.searchParams.set("from", from);
            return Response.json({
              error: "当前访问域名与行者授权回调域名不一致。请在配置的地址登录 Cycler 后重新连接。",
              connectionUrl: connectionUrl.toString(),
            }, { status: 409, headers });
          }
          const query = new URLSearchParams();
          if (from === "chat" || from === "profile") query.set("from", from);
          if (from === "chat" && isConversationId(conversationId)) query.set("conversation", conversationId);
          const authorizationUrl = await startXingzheAuthorization(repository, session.userId, setup.config, sessionToken, query.toString());
          return Response.json({ authorizationUrl }, { headers });
        }
        if (action !== "sync" && !reimportDeleted) return Response.json({ error: "无效的行者同步操作。" }, { status: 422, headers });
        const connection = await repository.getXingzheConnection(session.userId);
        if (!connection || connection.paused) throw new PlatformError("请先连接行者。");
        return rateLimited("行者", connection.retryAt, headers) ?? liveResponse(await syncXingzhe(repository, session.userId, setup.config, fetch, action), headers);
      }
      if (session.accountEmail) return Response.json({ error: "当前服务还未启用行者授权同步。", syncUnavailable: setup.issue }, { status: 409, headers });
    }
    if (session.accountEmail) {
      return Response.json({ error: `${platformInfo(provider).name}账号同步暂未开放，可使用文件导入。` }, { status: 409, headers });
    }
    const value = await updatePlatform(repository, session.userId, action as PlatformAction, range, scenario, provider);
    return Response.json(value, { headers });
  } catch (error) {
    if (error instanceof ManualSyncInProgressError) {
      return Response.json({ error: "行者正在同步，请等这次同步完成后再试。" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: error instanceof PlatformError ? error.message : "同步暂时不可用，请重试。" }, { status: error instanceof PlatformError ? 409 : 503 });
  }
}
