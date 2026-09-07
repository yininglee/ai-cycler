import { createImportedRideId, saveImportedRide } from "../../../../src/imports/demo-ride-store.ts";
import { AuthConfigurationError, resolveOrCreateRequestSession, sessionCookieHeader } from "../../../../src/auth/session.ts";
import { getApplicationRepository } from "../../../../src/persistence/application-repository.ts";
import { createDemoEvent } from "../../../../src/observability/demo-events.ts";
import { parseRideRecord, isRideParseError } from "../../../../src/parsers/index.ts";
import { MAX_UPLOAD_BYTES } from "../../../../src/parsers/parser-utils.ts";

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

export async function POST(request: Request): Promise<Response> {
  let session;
  try { session = resolveOrCreateRequestSession(request); } catch (error) {
    if (error instanceof AuthConfigurationError) return noStoreJson({ error: error.code }, 503);
    return noStoreJson({ error: "AUTH_UNAVAILABLE" }, 503);
  }
  await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({ type: "import_started" }));
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    return noStoreJson({ error: "FILE_TOO_LARGE", message: "上传文件超过 50 MB 限制" }, 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return noStoreJson({ error: "INVALID_UPLOAD", message: "无法读取上传文件" }, 400);
  }

  const upload = formData.get("file");
  if (!(upload instanceof File)) {
    return noStoreJson({ error: "MISSING_FILE", message: "请选择一个 FIT 或 GPX 文件" }, 400);
  }
  if (!isSupportedFileName(upload.name)) {
    return noStoreJson({ error: "UNSUPPORTED_FILE_TYPE", message: "当前只支持 .fit 和 .gpx 文件" }, 422);
  }
  if (upload.size > MAX_UPLOAD_BYTES) {
    return noStoreJson({ error: "FILE_TOO_LARGE", message: "上传文件超过 50 MB 限制" }, 413);
  }

  const rideId = createImportedRideId();
  try {
    const record = await parseRideRecord({
      rideId,
      fileName: upload.name,
      content: new Uint8Array(await upload.arrayBuffer()),
    });
    await getApplicationRepository().saveRide(session.userId, record);
    await getApplicationRepository().saveDemoEvent(session.userId, createDemoEvent({
      type: "import_completed",
      rideId,
      attributes: { source: record.activity.source.kind },
    }));
    // Keep the legacy in-memory fixture bridge for existing development tests.
    saveImportedRide(record);
    return noStoreJson({ rideId }, 201, sessionCookieHeader(session));
  } catch (error) {
    if (isRideParseError(error)) {
      const status = error.code === "FILE_TOO_LARGE" ? 413 : 422;
      return noStoreJson({ error: error.code, message: error.message }, status);
    }
    return noStoreJson({ error: "IMPORT_FAILED", message: "文件暂时无法读取，请确认文件完整后重试" }, 422);
  }
}
