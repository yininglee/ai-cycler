import { getAccountRequestSession, signInRequiredResponse } from "../../../../../src/auth/session.ts";
import { getImportRateLimiter } from "../../../../../src/imports/import-rate-limit.ts";
import { importOnelapBatch, OnelapArchiveError } from "../../../../../src/imports/onelap-batch-import.ts";
import { ONELAP_BATCH_MAX_BYTES, ONELAP_BATCH_MAX_FILES, ONELAP_BATCH_MAX_MB, onelapBatchKind } from "../../../../../src/imports/onelap-batch.ts";
import { getApplicationRepository } from "../../../../../src/persistence/application-repository.ts";

export const runtime = "nodejs";

// Allow for multipart headers in addition to the file bytes.
const MAX_REQUEST_BYTES = ONELAP_BATCH_MAX_BYTES + 2 * 1024 * 1024;
const batchSizeMessage = `单批文件总大小最多 ${ONELAP_BATCH_MAX_MB} MB，请分批导入。`;

function json(value: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if ((site && !["same-origin", "none"].includes(site)) || (!site && origin && origin !== new URL(request.url).origin)) {
    return json({ message: "请从 Cycler 的顽鹿导入页上传文件。" }, 403);
  }
  // This route checks the account itself so the Next.js Proxy does not buffer the upload.
  let session;
  try {
    session = getAccountRequestSession(request);
  } catch {
    return json({ message: "账号服务暂不可用，请稍后重试。" }, 503);
  }
  if (!session) return signInRequiredResponse();
  const contentType = request.headers.get("content-type");
  if (!request.body || !contentType || !/^multipart\/form-data;/i.test(contentType)) {
    return json({ message: "请选择一个 ZIP 或多个 FIT 文件。" }, 400);
  }
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) return json({ message: batchSizeMessage }, 413);
  const limit = getImportRateLimiter().check(session.userId);
  if (!limit.allowed) {
    return json({ message: "导入请求过于频繁，请稍后再试。" }, 429, { "Retry-After": String(limit.retryAfterSeconds) });
  }

  let receivedBytes = 0;
  let exceeded = false;
  const boundedBody = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > MAX_REQUEST_BYTES) {
        exceeded = true;
        controller.error(new Error("Upload exceeds size limit"));
      } else controller.enqueue(chunk);
    },
  }));
  let form: FormData;
  try {
    form = await new Response(boundedBody, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    return exceeded ? json({ message: batchSizeMessage }, 413) : json({ message: "无法读取上传文件，请重试。" }, 400);
  }
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  const kind = onelapBatchKind(files);
  if (!kind) return json({ message: "每批请选择一个 ZIP，或选择一个或多个 FIT 文件。" }, 422);
  if (files.length > ONELAP_BATCH_MAX_FILES) {
    return json({ message: `每批最多导入 ${ONELAP_BATCH_MAX_FILES} 个 FIT 文件，请分批导入。` }, 413);
  }
  if (files.reduce((bytes, file) => bytes + file.size, 0) > ONELAP_BATCH_MAX_BYTES) {
    return json({ message: batchSizeMessage }, 413);
  }
  try {
    return json(await importOnelapBatch(getApplicationRepository(), session.userId, files, kind, request.signal));
  } catch (error) {
    if (error instanceof OnelapArchiveError) return json({ message: error.message }, 422);
    return json({ message: "本次导入中断，重新上传时会跳过已导入的记录。" }, 503);
  }
}
