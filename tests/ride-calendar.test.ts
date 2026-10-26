import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarDate, calendarMonthDates, calendarWeekStart, distanceHeatLevel, ridesByDate,
  shiftCalendarMonth, summarizeCalendarRides, type CalendarRide,
} from "../src/ui/ride-calendar.ts";

function ride(overrides: Partial<CalendarRide> = {}): CalendarRide {
  return {
    id: "morning", startTime: "2026-10-05T08:00:00+08:00", date: "2026-10-05",
    source: "FIT", distanceM: 12_000, durationS: 1800, avgSpeedMps: 6.67,
    elevationM: 100, ...overrides,
  };
}

test("Shanghai calendar dates respect midnight and year boundaries", () => {
  assert.equal(calendarDate("2026-10-04T16:01:00Z"), "2026-10-05");
  assert.equal(calendarDate("2026-12-31T16:00:00Z"), "2027-01-01");
  assert.equal(calendarDate("not a date"), null);
});

test("same-day rides remain distinct and sort by departure time", () => {
  const morning = ride();
  const evening = ride({ id: "evening", startTime: "2026-10-05T18:00:00+08:00", distanceM: 23_000 });
  const otherDay = ride({ id: "other", date: "2026-10-06" });
  const unknown = ride({ id: "unknown", date: null, startTime: null });
  const groups = ridesByDate([evening, unknown, otherDay, morning]);
  assert.deepEqual(groups.get("2026-10-05")?.map((item) => item.id), ["morning", "evening"]);
  assert.equal(groups.size, 2);
  assert.deepEqual(summarizeCalendarRides(groups.get("2026-10-05")!), {
    count: 2, distanceM: 35_000, durationS: 3600, elevationM: 200, partial: false,
  });
});

test("heat thresholds use daily total distance and distinguish no activity", () => {
  assert.equal(distanceHeatLevel([]), 0);
  assert.equal(distanceHeatLevel([ride({ distanceM: null })]), 1);
  assert.equal(distanceHeatLevel([ride({ distanceM: 19_999 })]), 1);
  assert.equal(distanceHeatLevel([ride({ distanceM: 20_000 })]), 2);
  assert.equal(distanceHeatLevel([ride({ distanceM: 49_999 })]), 2);
  assert.equal(distanceHeatLevel([ride({ distanceM: 50_000 })]), 3);
  assert.equal(distanceHeatLevel([ride({ distanceM: 99_999 })]), 3);
  assert.equal(distanceHeatLevel([ride({ distanceM: 60_000 }), ride({ distanceM: 40_000 })]), 4);
});

test("missing measurements stay unknown; partial totals include known values only", () => {
  const unknown = ride({ distanceM: null, durationS: null, elevationM: null });
  assert.deepEqual(summarizeCalendarRides([unknown]), {
    count: 1, distanceM: null, durationS: null, elevationM: null, partial: true,
  });
  assert.deepEqual(summarizeCalendarRides([ride(), unknown]), {
    count: 2, distanceM: 12_000, durationS: 1800, elevationM: 100, partial: true,
  });
  assert.deepEqual(summarizeCalendarRides([]), {
    count: 0, distanceM: 0, durationS: 0, elevationM: 0, partial: false,
  });
});

test("month navigation crosses year boundaries in either direction", () => {
  assert.equal(shiftCalendarMonth("2026-12", 1), "2027-01");
  assert.equal(shiftCalendarMonth("2026-01", -1), "2025-12");
});

test("monthly heatmap dates are sequential and include leap days", () => {
  assert.equal(calendarMonthDates("2024-02").length, 29);
  assert.equal(calendarMonthDates("2025-02").length, 28);
  assert.equal(calendarMonthDates("2026-10")[0], "2026-10-01");
  assert.equal(calendarMonthDates("2026-10").at(-1), "2026-10-31");
});

test("week summary starts on Monday across month and year boundaries", () => {
  assert.equal(calendarWeekStart("2026-10-26"), "2026-10-26");
  assert.equal(calendarWeekStart("2026-11-01"), "2026-10-26");
  assert.equal(calendarWeekStart("2027-01-01"), "2026-12-28");
});
