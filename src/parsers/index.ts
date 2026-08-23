import type { RideActivity, RideRecord } from "../domain/ride-schema.ts";
import { parseFitRide } from "./fit-parser.ts";
import { parseGpxRide } from "./gpx-parser.ts";
import { RideParseError } from "./parse-errors.ts";

export type RideFileInput =
  | { rideId: string; fileName: string; content: Uint8Array }
  | { rideId: string; fileName: string; content: string };

export async function parseRideRecord(input: RideFileInput): Promise<RideRecord> {
  const lowerName = input.fileName.toLowerCase();
  if (lowerName.endsWith(".fit")) {
    if (typeof input.content === "string") {
      throw new RideParseError("UNSUPPORTED_FILE_TYPE", "FIT文件必须以二进制方式读取");
    }
    return parseFitRide({ rideId: input.rideId, fileName: input.fileName, bytes: input.content });
  }
  if (lowerName.endsWith(".gpx")) {
    let xml: string;
    try {
      xml = typeof input.content === "string"
        ? input.content
        : new TextDecoder("utf-8", { fatal: true }).decode(input.content);
    } catch (error) {
      throw new RideParseError("GPX_INVALID_ENCODING", "GPX不是有效的UTF-8文本", error);
    }
    return parseGpxRide({ rideId: input.rideId, fileName: input.fileName, xml });
  }
  throw new RideParseError("UNSUPPORTED_FILE_TYPE", "当前只支持.fit和.gpx文件");
}

export async function parseRideFile(input: RideFileInput): Promise<RideActivity> {
  return (await parseRideRecord(input)).activity;
}

export { RideParseError, isRideParseError } from "./parse-errors.ts";
