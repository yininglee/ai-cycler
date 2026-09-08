import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDeclaredMimeType,
  assertFitFileSignature,
  assertGpxFileSignature,
} from "../src/parsers/file-signature.ts";
import { isRideParseError, RideParseError } from "../src/parsers/parse-errors.ts";

function expectCode(fn: () => void, code: string): void {
  try {
    fn();
    assert.fail(`expected RideParseError ${code}`);
  } catch (error) {
    assert.ok(isRideParseError(error) && error.code === code, `expected ${code}, got ${String(error)}`);
  }
}

/** 按 Garmin FIT 规范构造文件头：头长度 + 协议/Profile 版本 + 数据长度 + ".FIT" 签名。 */
function fitHeaderBytes(headerSize: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes[0] = headerSize;
  bytes[1] = 0x02; // protocol version
  bytes[2] = 0x52; bytes[3] = 0x08; // profile version 2130
  bytes[8] = 0x2e; bytes[9] = 0x46; bytes[10] = 0x49; bytes[11] = 0x54; // ".FIT"
  return bytes;
}

test("FIT signature accepts legacy (12-byte) and current (14-byte) standard headers", () => {
  assert.doesNotThrow(() => assertFitFileSignature(fitHeaderBytes(12)));
  assert.doesNotThrow(() => assertFitFileSignature(fitHeaderBytes(14)));
});

test("FIT signature rejects wrong magic, wrong header size, and truncated files", () => {
  const notFit = new TextEncoder().encode("<?xml version=\"1.0\"?><gpx></gpx>");
  expectCode(() => assertFitFileSignature(notFit), "FILE_HEADER_MISMATCH");
  expectCode(() => assertFitFileSignature(fitHeaderBytes(13)), "FILE_HEADER_MISMATCH");
  expectCode(() => assertFitFileSignature(fitHeaderBytes(14).slice(0, 8)), "FILE_HEADER_MISMATCH");
  expectCode(() => assertFitFileSignature(new Uint8Array(0)), "FILE_HEADER_MISMATCH");
});

test("GPX signature accepts XML declaration, bare gpx root, BOM, and leading whitespace", () => {
  assert.doesNotThrow(() => assertGpxFileSignature("<?xml version=\"1.0\"?><gpx/>"));
  assert.doesNotThrow(() => assertGpxFileSignature("<gpx version=\"1.1\"><trk/></gpx>"));
  assert.doesNotThrow(() => assertGpxFileSignature("\uFEFF<?xml version=\"1.0\"?><gpx/>"));
  assert.doesNotThrow(() => assertGpxFileSignature("   \n<gpx/>"));
});

test("GPX signature rejects non-XML content regardless of extension", () => {
  expectCode(() => assertGpxFileSignature("distance,time\n1,2"), "FILE_HEADER_MISMATCH");
  expectCode(() => assertGpxFileSignature("{\"trk\": []}"), "FILE_HEADER_MISMATCH");
  expectCode(() => assertGpxFileSignature(""), "FILE_HEADER_MISMATCH");
});

test("declared MIME passes when empty, whitelisted, or case-different; rejects conflicts", () => {
  assert.doesNotThrow(() => assertDeclaredMimeType("ride.fit", ""));
  assert.doesNotThrow(() => assertDeclaredMimeType("ride.fit", "application/octet-stream"));
  assert.doesNotThrow(() => assertDeclaredMimeType("ride.fit", "application/vnd.garmin.fit"));
  assert.doesNotThrow(() => assertDeclaredMimeType("ride.gpx", "APPLICATION/GPX+XML"));
  assert.doesNotThrow(() => assertDeclaredMimeType("ride.gpx", "text/xml"));
  // 未登记扩展名（.csv 等）不在此校验，交由扩展名检查拒绝。
  assert.doesNotThrow(() => assertDeclaredMimeType("ride.csv", "text/csv"));

  expectCode(() => assertDeclaredMimeType("ride.fit", "image/png"), "UNSUPPORTED_MIME_TYPE");
  expectCode(() => assertDeclaredMimeType("ride.gpx", "application/json"), "UNSUPPORTED_MIME_TYPE");
});

test("RideParseError remains the stable carrier for the new boundary codes", () => {
  const error = new RideParseError("FILE_HEADER_MISMATCH", "test");
  assert.equal(isRideParseError(error), true);
  assert.equal(error.code, "FILE_HEADER_MISMATCH");
});
