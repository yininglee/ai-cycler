import { fromBufferPromise, type Entry, type ZipFile } from "yauzl";
import { isRideParseError } from "../parsers/parse-errors.ts";
import { assertDeclaredMimeType } from "../parsers/file-signature.ts";
import { MAX_UPLOAD_BYTES } from "../parsers/parser-utils.ts";
import type { FileApplicationRepository } from "../persistence/application-repository.ts";
import { importRideBytes } from "./ride-import-service.ts";
import { ONELAP_BATCH_MAX_FILES, type OnelapBatchResult } from "./onelap-batch.ts";

const MAX_ARCHIVE_ENTRIES = 1000;
const MAX_EXPANDED_FIT_BYTES = 256 * 1024 * 1024;

export class OnelapArchiveError extends Error {}

function isFitEntry(name: string) {
  const segments = name.split("/");
  return /\.fit$/i.test(name) && !segments.includes("__MACOSX") && !segments.at(-1)?.startsWith("._");
}

async function listFits(zip: ZipFile, signal: AbortSignal) {
  if (zip.entryCount > MAX_ARCHIVE_ENTRIES) throw new OnelapArchiveError("ZIP 内文件太多，请分批导出。");
  const entries: Entry[] = [];
  let expandedBytes = 0;
  for await (const entry of zip.eachEntry()) {
    signal.throwIfAborted();
    if (!isFitEntry(entry.fileName)) continue;
    entries.push(entry);
    if (entries.length > ONELAP_BATCH_MAX_FILES) {
      throw new OnelapArchiveError(`ZIP 内 FIT 文件超过 ${ONELAP_BATCH_MAX_FILES} 个，请分批导出。`);
    }
    if (entry.uncompressedSize <= MAX_UPLOAD_BYTES) expandedBytes += entry.uncompressedSize;
    if (expandedBytes > MAX_EXPANDED_FIT_BYTES) throw new OnelapArchiveError("ZIP 内可导入的 FIT 解压后超过 256 MB，请分批导出。");
  }
  if (!entries.length) throw new OnelapArchiveError("ZIP 内没有找到 FIT 文件。");
  return entries;
}

async function readZipFit(zip: ZipFile, entry: Entry, signal: AbortSignal) {
  const stream = await zip.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    signal.throwIfAborted();
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) throw new OnelapArchiveError("FIT 文件超过 50 MB。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

export async function importOnelapBatch(repository: Pick<FileApplicationRepository, "importRide">, ownerId: string,
  files: File[], kind: "zip" | "fit", signal: AbortSignal): Promise<OnelapBatchResult> {
  const result: OnelapBatchResult = { added: 0, duplicate: 0, failed: 0, rideIds: [], failures: [] };
  function fail(name: string, message: string) {
    const fileName = (name.split(/[\\/]/).at(-1) ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
    result.failed++;
    result.failures.push({ fileName, message });
  }
  async function importFit(name: string, size: number, read: () => Promise<Uint8Array>) {
    signal.throwIfAborted();
    if (size > MAX_UPLOAD_BYTES) {
      fail(name, "FIT 文件超过 50 MB。");
      return;
    }
    try {
      const bytes = await read();
      signal.throwIfAborted();
      const { result: imported } = await importRideBytes(repository, ownerId, name, bytes, { platformId: "onelap" });
      if (!imported?.rideId) throw new Error("No imported ride ID");
      if (imported.duplicate) result.duplicate++;
      else {
        result.added++;
        result.rideIds.push(imported.rideId);
      }
    } catch (error) {
      signal.throwIfAborted();
      fail(name, isRideParseError(error) || error instanceof OnelapArchiveError ? error.message : "文件无法读取或保存，请检查文件后重试。");
    }
  }
  if (kind === "fit") {
    for (const file of files) {
      await importFit(file.name, file.size, async () => {
        assertDeclaredMimeType(file.name, file.type);
        return new Uint8Array(await file.arrayBuffer());
      });
    }
    return result;
  }

  let zip: ZipFile | undefined;
  try {
    zip = await fromBufferPromise(Buffer.from(await files[0]!.arrayBuffer()), { strictFileNames: true });
    const entries = await listFits(zip, signal);
    const archive = zip;
    for (const entry of entries) {
      await importFit(entry.fileName, entry.uncompressedSize, () => readZipFit(archive, entry, signal));
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof OnelapArchiveError) throw error;
    throw new OnelapArchiveError("无法读取 ZIP，请确认文件完整后重试。");
  } finally {
    zip?.close();
  }
  return result;
}
