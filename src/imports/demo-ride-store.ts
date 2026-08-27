import type { RideRecord } from "../domain/ride-schema.ts";
import { getRideFixture } from "../fixtures/rides.ts";
import { isDemoRideId } from "../ui/ride-view-model.ts";

const STORE_KEY = "__aiCyclingBuddyDemoRideStore";

type DemoRideStore = Map<string, RideRecord>;

function importedRideStore(): DemoRideStore {
  const state = globalThis as typeof globalThis & { [STORE_KEY]?: DemoRideStore };
  if (!state[STORE_KEY]) state[STORE_KEY] = new Map();
  return state[STORE_KEY];
}

export function createImportedRideId(): string {
  return `upload-${crypto.randomUUID()}`;
}

/**
 * Only normalized RideRecord values are retained. Raw FIT/GPX bytes and
 * precise coordinates have already been discarded by the parser boundary.
 */
export function saveImportedRide(record: RideRecord): string {
  importedRideStore().set(record.activity.rideId, structuredClone(record));
  return record.activity.rideId;
}

export function getImportedRide(rideId: string): RideRecord | undefined {
  const record = importedRideStore().get(rideId);
  return record ? structuredClone(record) : undefined;
}

export function getRideRecord(rideId: string): RideRecord | undefined {
  if (isDemoRideId(rideId)) {
    const fixture = getRideFixture(rideId);
    return { activity: fixture.activity, series: fixture.series };
  }
  return getImportedRide(rideId);
}

export function isKnownRideId(rideId: string): boolean {
  return getRideRecord(rideId) !== undefined;
}
