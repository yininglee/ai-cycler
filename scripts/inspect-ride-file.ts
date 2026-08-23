import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { buildRideCapability, validateRideActivity } from "../src/domain/ride-rules.ts";
import { validateRideSeries } from "../src/domain/ride-series.ts";
import { isRideParseError, parseRideRecord } from "../src/parsers/index.ts";

const filePath = process.argv.slice(2).find((argument) => argument !== "--");
if (!filePath) {
  console.error("用法：pnpm inspect:ride -- /绝对路径/ride.fit（或ride.gpx）");
  process.exitCode = 2;
} else {
  try {
    const content = new Uint8Array(await readFile(filePath));
    const record = await parseRideRecord({
      rideId: "local-preview",
      fileName: basename(filePath),
      content,
    });
    const { activity, series } = record;
    const validation = validateRideActivity(activity);
    const seriesValidation = validateRideSeries(series, activity);
    const capability = buildRideCapability(activity);
    console.log(JSON.stringify({ activity, series, validation, seriesValidation, capability }, null, 2));
    if (!validation.valid || !seriesValidation.valid) process.exitCode = 1;
  } catch (error) {
    if (isRideParseError(error)) {
      console.error(JSON.stringify({ code: error.code, message: error.message }, null, 2));
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}
