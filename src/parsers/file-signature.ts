import { RideParseError } from "./parse-errors.ts";

/**
 * MVP-FOUNDATION-04 输入边界：在解析前校验文件头与声明的 MIME 类型。
 * 文件头是权威判据；MIME 白名单只在浏览器/系统声明了类型时做一致性检查，
 * 避免 OS/浏览器对 .fit/.gpx 探测不可靠导致误伤。
 */

const FIT_HEADER_MIN_BYTES = 12;
const FIT_LEGACY_HEADER_SIZE = 12;
const FIT_CURRENT_HEADER_SIZE = 14;
/** Garmin FIT 规范：".FIT" 文件签名位于头部字节 8–11（头长度/协议版本/Profile版本/数据长度之后）。 */
const FIT_MAGIC = ".FIT";
const FIT_MAGIC_OFFSET = 8;

/** 各扩展名允许的声明 MIME；空字符串（未声明）直接放行。 */
const ALLOWED_MIME_BY_EXTENSION: Record<string, ReadonlySet<string>> = {
  ".fit": new Set([
    "application/octet-stream",
    "application/vnd.garmin.fit",
    "application/fit",
    "binary/octet-stream",
  ]),
  ".gpx": new Set([
    "application/gpx+xml",
    "application/xml",
    "text/xml",
    "text/gpx+xml",
    "application/octet-stream",
  ]),
};

function extensionOf(fileName: string): string {
  const index = fileName.toLowerCase().lastIndexOf(".");
  return index === -1 ? "" : fileName.toLowerCase().slice(index);
}

/** FIT 标准文件头：首字节为头长度（12 或 14），字节 8–11 为 ASCII ".FIT" 签名。 */
export function assertFitFileSignature(bytes: Uint8Array): void {
  const magic = String.fromCharCode(...bytes.slice(FIT_MAGIC_OFFSET, FIT_MAGIC_OFFSET + FIT_MAGIC.length));
  if (
    bytes.length < FIT_HEADER_MIN_BYTES ||
    (bytes[0] !== FIT_LEGACY_HEADER_SIZE && bytes[0] !== FIT_CURRENT_HEADER_SIZE) ||
    magic !== FIT_MAGIC
  ) {
    throw new RideParseError(
      "FILE_HEADER_MISMATCH",
      "文件内容不是有效的 FIT 格式（文件头校验失败）",
    );
  }
}

/** GPX 签名：去除 BOM 与前置空白后必须是 XML 声明或 <gpx 根元素。 */
export function assertGpxFileSignature(xml: string): void {
  const normalized = xml.replace(/^\uFEFF/, "").trimStart();
  if (!normalized.startsWith("<?xml") && !normalized.startsWith("<gpx")) {
    throw new RideParseError(
      "FILE_HEADER_MISMATCH",
      "文件内容不是有效的 GPX/XML 格式（文件头校验失败）",
    );
  }
}

/** 声明 MIME 与扩展名白名单一致性；未声明（空）不校验。 */
export function assertDeclaredMimeType(fileName: string, mimeType: string): void {
  const declared = mimeType.trim().toLowerCase();
  if (declared === "") return;
  const allowed = ALLOWED_MIME_BY_EXTENSION[extensionOf(fileName)];
  if (allowed && !allowed.has(declared)) {
    throw new RideParseError(
      "UNSUPPORTED_MIME_TYPE",
      `文件的 MIME 类型（${mimeType}）与 .fit/.gpx 格式不符`,
    );
  }
}

export function allowedMimeTypesForFile(fileName: string): ReadonlySet<string> | undefined {
  return ALLOWED_MIME_BY_EXTENSION[extensionOf(fileName)];
}
