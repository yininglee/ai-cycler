import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { buildRideElevationSummary } from "../src/domain/ride-elevation.ts";
import { buildRideEventClimbSummary } from "../src/domain/ride-event-climbs.ts";
import { buildRidePowerSummary } from "../src/domain/ride-power.ts";
import { validateRideActivity } from "../src/domain/ride-rules.ts";
import { validateRideSeries } from "../src/domain/ride-series.ts";
import { buildRideRouteShapeSummary } from "../src/domain/ride-route-shape.ts";
import { buildRideTimingSummary } from "../src/domain/ride-timing.ts";
import { buildCadenceZoneDistribution, buildHeartRateZoneDistribution } from "../src/domain/ride-zones.ts";
import { parseRideRecord } from "../src/parsers/index.ts";
import type { UserProfile } from "../src/domain/user-profile.ts";

const files = process.argv.slice(2).filter((value) => value !== "--");
if (files.length === 0) {
  console.error("用法：pnpm regression:advanced -- /path/ride.fit [/path/ride.gpx ...]");
  process.exitCode = 2;
} else {
  const profile: UserProfile = {
    schemaVersion: "0.1",
    updatedAt: "2026-08-30T00:00:00.000Z",
    weightKg: { value: 70, source: "user_provided", createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z" },
    maxHeartRate: { valueBpm: 190, source: "user_provided", createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z" },
    ftp: { valueWatts: 239, source: "user_provided", trustStatus: "user_confirmed", createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z" },
  };

  const results = [];
  for (const filePath of files) {
    const content = new Uint8Array(await readFile(filePath));
    const record = await parseRideRecord({ rideId: basename(filePath), fileName: basename(filePath), content });
    const validation = validateRideActivity(record.activity);
    const seriesValidation = validateRideSeries(record.series, record.activity);
    const timing = buildRideTimingSummary(record);
    const elevation = buildRideElevationSummary(record);
    const route = buildRideRouteShapeSummary(elevation);
    const climbs = buildRideEventClimbSummary(elevation, route);
    const heartRate = buildHeartRateZoneDistribution(record, profile);
    const cadence = buildCadenceZoneDistribution(record);
    const power = buildRidePowerSummary(record, profile);
    results.push({
      file: basename(filePath),
      sourceKind: record.activity.source.kind,
      validation: { activity: validation.valid, series: seriesValidation.valid, issues: [...validation.issues, ...seriesValidation.issues] },
      metrics: Object.fromEntries(Object.entries(record.activity.metrics).map(([key, metric]) => [key, metric?.value])),
      timing: { elapsedTimeS: timing.elapsedTimeS, movingTimeS: timing.movingTimeS, stopCount: timing.stops.length, cruiseCount: timing.cruiseSegments.length },
      elevation: { gainM: elevation.gainM, lossM: elevation.lossM, minM: elevation.minM, maxM: elevation.maxM, source: elevation.gainSource },
      route: { available: route.isAvailable, trendDistanceM: route.trendSegments?.reduce((sum, segment) => sum + segment.distanceM, 0), trendTypes: route.trendSegments?.reduce<Record<string, number>>((acc, segment) => { acc[segment.type] = (acc[segment.type] ?? 0) + segment.distanceM; return acc; }, {}) },
      eventClimbs: { available: climbs.isAvailable, count: climbs.climbs.length },
      heartRate: { coverage: heartRate.coverage, unavailableReason: heartRate.unavailableReason, bins: heartRate.bins.filter((bin) => bin.durationS > 0).length },
      cadence: { coverage: cadence.coverage, unavailableReason: cadence.unavailableReason, bins: cadence.bins.filter((bin) => bin.durationS > 0).length },
      power: { qualityLevel: power.qualityLevel, coverage: power.coverage, longestGapS: power.longestGapS, gapCount: power.gapCount, unavailableReasons: power.unavailableReasons, normalizedPowerW: power.normalizedPowerW, peakPowers: power.peakPowers?.map((peak) => ({ seconds: peak.durationS, watts: peak.averagePowerW })) },
    });
  }
  console.log(JSON.stringify({ rules: { timing: "ride-timing-rules-v0.2", elevation: "ride-elevation-rules-v0.3", route: "ride-route-shape-rules-v0.2", climbs: "ride-event-climb-rules-v0.2", zones: "ride-zone-rules-v0.1", power: "ride-power-rules-v0.1", peaks: "ride-power-peak-rules-v0.1" }, profile: { weightKg: 70, maxHeartRateBpm: 190, ftpW: 239 }, results }, null, 2));
}
