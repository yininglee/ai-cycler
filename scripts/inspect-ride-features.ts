import { buildRideFeatureSnapshot } from "../src/domain/ride-features.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const fixtureIds = process.argv.slice(2);
const selected = fixtureIds.length > 0 ? fixtureIds : ["l1-built-in-sample", "l2-built-in-sample", "l3-built-in-sample", "gpx-no-timestamps"];

for (const fixtureId of selected) {
  const fixture = getRideFixture(fixtureId);
  const record: RideRecord = { activity: fixture.activity, series: fixture.series };
  const snapshot = buildRideFeatureSnapshot(record);
  console.log(JSON.stringify({
    fixtureId,
    schemaVersion: snapshot.schemaVersion,
    rulesVersion: snapshot.rulesVersion,
    featureCount: snapshot.features.length,
    featureKeys: snapshot.features.map((feature) => feature.key),
    unavailable: snapshot.unavailable,
  }, null, 2));
}
