import { createHash } from "node:crypto";
import type { RideRecord } from "../domain/ride-schema.ts";
import { parseRideRecord } from "../parsers/index.ts";
import type { FileApplicationRepository } from "../persistence/application-repository.ts";
import { createImportedRideId } from "./demo-ride-store.ts";

export async function importRideBytes(repository: Pick<FileApplicationRepository, "importRide">, ownerId: string, fileName: string, bytes: Uint8Array, oneLap?: { connectionId: string; key: string }): Promise<{
  result: Awaited<ReturnType<FileApplicationRepository["importRide"]>>;
  record?: RideRecord;
}> {
  const hash = createHash("sha256").update(bytes).digest("base64url");
  let record: RideRecord | undefined;
  const result = await repository.importRide(ownerId, hash, async () => {
    record = await parseRideRecord({ rideId: createImportedRideId(), fileName, content: bytes });
    if (oneLap) record.activity.source.platformId = "onelap";
    return record;
  }, oneLap);
  return { result, record };
}
