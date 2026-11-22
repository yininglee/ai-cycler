import { createHash } from "node:crypto";
import type { RideRecord } from "../domain/ride-schema.ts";
import { validateRideRecord } from "../domain/ride-series.ts";
import { parseRideRecord, RideParseError } from "../parsers/index.ts";
import type { FileApplicationRepository, RideImportSource } from "../persistence/application-repository.ts";
import type { ImportPlatformId } from "../ux/platform-catalog.ts";
import { createImportedRideId } from "./demo-ride-store.ts";

export async function importRideBytes(repository: Pick<FileApplicationRepository, "importRide">, ownerId: string, fileName: string, bytes: Uint8Array, origin?: { platformId: ImportPlatformId; source?: RideImportSource }): Promise<{
  result: Awaited<ReturnType<FileApplicationRepository["importRide"]>>;
  record?: RideRecord;
}> {
  const hash = createHash("sha256").update(bytes).digest("base64url");
  let record: RideRecord | undefined;
  const result = await repository.importRide(ownerId, hash, async (rideId = createImportedRideId()) => {
    record = await parseRideRecord({ rideId, fileName, content: bytes });
    if (origin) record.activity.source.platformId = origin.platformId;
    if (origin?.source?.provider === "xingzhe" && !validateRideRecord(record).valid) {
      throw new RideParseError("FIT_INVALID_OR_CORRUPT", "行者 FIT 未通过骑行数据校验。");
    }
    return record;
  }, origin?.source);
  return { result, record };
}
