import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarDate, calendarHeatmapLayout, calendarMonthDates, calendarWeekStart, distanceHeatLevel, ridesByDate,
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


test("daily heatmap stays continuous through month and year boundaries", () => {
  const { days, months } = calendarHeatmapLayout("2026-12", "2027-01");
  assert.equal(days[0], "2026-11-30"); // Monday, with December starting on Tuesday.
  assert.equal(days.at(-1), "2027-01-31");
  assert.equal(days.length, 63);
  assert.equal(new Set(days).size, days.length);
  for (let i = 1; i < days.length; i++) assert.equal(Date.parse(days[i]) - Date.parse(days[i - 1]), 86400000);
  assert.deepEqual(months, [{ month: "2026-12", column: 1 }, { month: "2027-01", column: 5 }]);
});

test("daily heatmap includes leap day once and does not reset at March", () => {
  const { days, months } = calendarHeatmapLayout("2024-02", "2024-03");
  const leapDay = days.indexOf("2024-02-29");
  assert.ok(leapDay > 0);
  assert.deepEqual(days.slice(leapDay - 1, leapDay + 2), ["2024-02-28", "2024-02-29", "2024-03-01"]);
  assert.equal(months[1].column, Math.floor((leapDay + 1) / 7) + 1);
});


test("daily heatmap stops at the requested day with no future cells or month labels", () => {
  for (const today of ["2026-11-02", "2027-01-01", "2024-02-29"]) {
    const { days, months } = calendarHeatmapLayout(today.slice(0, 4) + "-01", today.slice(0, 7), today);
    assert.equal(days.at(-1), today);
    assert.ok(days.every(date => date <= today));
    assert.ok(months.every(({ month }) => month <= today.slice(0, 7)));
  }
  const { days } = calendarHeatmapLayout("2026-10", "2026-12", "2026-11-02");
  assert.equal(days.at(-1), "2026-11-02");
  assert.ok(!days.includes("2026-11-03"));
});
