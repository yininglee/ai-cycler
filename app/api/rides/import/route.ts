import { saveImportedRide } from "../../../../src/imports/demo-ride-store.ts";
import { AuthConfigurationError, resolveOrCreateRequestSession, sessionCookieHeader, type RequestSession } from "../../../../src/auth/session.ts";
import { getApplicationRepository } from "../../../../src/persistence/application-repository.ts";
import { createDemoEvent } from "../../../../src/observability/demo-events.ts";
import { isRideParseError } from "../../../../src/parsers/index.ts";
import { MAX_UPLOAD_BYTES } from "../../../../src/parsers/parser-utils.ts";
import { assertDeclaredMimeType } from "../../../../src/parsers/file-signature.ts";
import { getImportRateLimiter } from "../../../../src/imports/import-rate-limit.ts";
import { isImportPlatform } from "../../../../src/ux/platform-catalog.ts";

import { importRideBytes } from "../../../../src/imports/ride-import-service.ts";

export const runtime = "nodejs";

function noStoreJson(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function isSupportedFileName(fileName: string): boolean {
  const normalized = fileName.toLowerCase();
  return normalized.endsWith(".fit") || normalized.endsWith(".gpx");
}

/** MVP-FOUNDATION-04：拒绝路径统一记录脱敏 import_rejected 事件（稳定错误码 + requestRef）。
 * 同时下发会话 Cookie，确保首次请求即被拒的客户端后续重试仍处于同一限流窗口。 */
async function rejectImport(
  session: RequestSession,
  requestId: string,
  code: string,
  message: string,
  status: number,
  headers: Record<string, string> = {},
): Promise<Response> {
  await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({
    type: "import_rejected",
    requestId,
    attributes: { code },
  }));
  return noStoreJson({ error: code, message }, status, { ...sessionCookieHeader(session), ...headers });
}

export async function POST(request: Request): Promise<Response> {
  const requestSite = request.headers.get("sec-fetch-site");
  if (requestSite && !["same-origin", "none"].includes(requestSite)) return noStoreJson({ error: "INVALID_UPLOAD" }, 403);
  let session;
  try { session = resolveOrCreateRequestSession(request); } catch (error) {
    if (error instanceof AuthConfigurationError) return noStoreJson({ error: error.code }, 503);
    return noStoreJson({ error: "AUTH_UNAVAILABLE" }, 503);
  }
  const requestId = crypto.randomUUID();

  const rateLimit = getImportRateLimiter().check(session.userId);
  if (!rateLimit.allowed) {
    return rejectImport(session, requestId, "IMPORT_RATE_LIMITED", "导入请求过于频繁，请稍后再试", 429, {
      "Retry-After": String(Math.max(1, rateLimit.retryAfterSeconds)),
    });
  }

  await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "import_started", requestId }));

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    return rejectImport(session, requestId, "FILE_TOO_LARGE", "上传文件超过 50 MB 限制", 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return rejectImport(session, requestId, "INVALID_UPLOAD", "无法读取上传文件", 400);
  }

  const platform = formData.get("platform");
  if (platform !== null && !isImportPlatform(platform)) {
    return rejectImport(session, requestId, "UNSUPPORTED_PLATFORM", "请选择顽鹿或行者作为记录来源。", 422);
  }
  const upload = formData.get("file");
  if (!(upload instanceof File)) {
    return rejectImport(session, requestId, "MISSING_FILE", "请选择一个 FIT 或 GPX 文件", 400);
  }
  if (!isSupportedFileName(upload.name)) {
    return rejectImport(session, requestId, "UNSUPPORTED_FILE_TYPE", "当前只支持 .fit 和 .gpx 文件", 422);
  }
  if (upload.size > MAX_UPLOAD_BYTES) {
    return rejectImport(session, requestId, "FILE_TOO_LARGE", "上传文件超过 50 MB 限制", 413);
  }
  try {
    assertDeclaredMimeType(upload.name, upload.type);
  } catch (error) {
    if (isRideParseError(error)) {
      return rejectImport(session, requestId, error.code, error.message, 422);
    }
    throw error;
  }

  const bytes = new Uint8Array(await upload.arrayBuffer());
  try {
    const repository = getApplicationRepository();
    const { result, record } = await importRideBytes(repository, session.userId, upload.name, bytes, platform ? { platformId: platform } : undefined);
    if (!result?.rideId) throw new Error("Import did not return a ride ID");
    await repository.saveDemoEvent(session.userId, createDemoEvent({
      type: "import_completed",
      rideId: result.rideId,
      requestId,
      attributes: record ? { source: record.activity.source.kind } : { deduplicated: "true" },
    }));
    if (record && !session.accountEmail) saveImportedRide(record);
    return result.duplicate
      ? noStoreJson({ rideId: result.rideId, duplicate: true }, 200, sessionCookieHeader(session))
      : noStoreJson({ rideId: result.rideId }, 201, sessionCookieHeader(session));
  } catch (error) {
    if (isRideParseError(error)) {
      const status = error.code === "FILE_TOO_LARGE" ? 413 : 422;
      return rejectImport(session, requestId, error.code, error.message, status);
    }
    return rejectImport(session, requestId, "IMPORT_FAILED", "文件暂时无法读取，请确认文件完整后重试", 422);
  }
}
