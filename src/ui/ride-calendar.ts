import type { RideRecord } from "../domain/ride-schema.ts";

// 列表展示投影：客户端日历不接收轨迹或仓储元数据。
export interface CalendarRide {
  id: string;
  startTime: string | null;
  date: string | null;
  source: string;
  distanceM: number | null;
  durationS: number | null;
  avgSpeedMps: number | null;
  elevationM: number | null;
}

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

export function calendarDate(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = dateFormatter.formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function toCalendarRide(record: RideRecord): CalendarRide {
  const metric = (key: keyof RideRecord["activity"]["metrics"]) => {
    const value = record.activity.metrics[key]?.value;
    return value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
  };
  return {
    id: record.activity.rideId,
    startTime: record.activity.startTime ?? null,
    date: record.activity.startTime ? calendarDate(record.activity.startTime) : null,
    source: record.activity.source.kind.toUpperCase(),
    distanceM: metric("distanceM"),
    durationS: metric("movingTimeS") ?? metric("elapsedTimeS"),
    avgSpeedMps: metric("avgSpeedMps"),
    elevationM: metric("elevationGainM"),
  };
}

export function ridesByDate(rides: CalendarRide[]): Map<string, CalendarRide[]> {
  const groups = new Map<string, CalendarRide[]>();
  for (const ride of [...rides].sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""))) {
    if (!ride.date) continue;
    const group = groups.get(ride.date) ?? [];
    group.push(ride);
    groups.set(ride.date, group);
  }
  return groups;
}

export function summarizeCalendarRides(rides: CalendarRide[]) {
  const sum = (key: "distanceM" | "durationS" | "elevationM") => {
    const values = rides.map((ride) => ride[key]).filter((value): value is number => value !== null);
    return values.length ? values.reduce((total, value) => total + value, 0) : rides.length ? null : 0;
  };
  return {
    count: rides.length,
    distanceM: sum("distanceM"),
    durationS: sum("durationS"),
    elevationM: sum("elevationM"),
    partial: rides.some((ride) => ride.distanceM === null || ride.durationS === null || ride.elevationM === null),
  };
}

export function distanceHeatLevel(rides: CalendarRide[]): number {
  if (!rides.length) return 0;
  const distanceM = summarizeCalendarRides(rides).distanceM ?? 0;
  return distanceM >= 100_000 ? 4 : distanceM >= 50_000 ? 3 : distanceM >= 20_000 ? 2 : 1;
}

export function shiftCalendarMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function calendarMonthDates(month: string): string[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

export function calendarNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
}

export function calendarDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ""}`;
}
