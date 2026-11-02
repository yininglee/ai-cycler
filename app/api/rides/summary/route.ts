import { resolveOrCreateRequestSession, sessionCookieHeader } from "../../../../src/auth/session.ts";
import { getRideRepository } from "../../../../src/persistence/demo-ride-repository.ts";
import { formatRideTitle } from "../../../../src/ui/ride-view-model.ts";
import { toCalendarRide } from "../../../../src/ui/ride-calendar.ts";

export async function GET(request: Request) {
  try {
    const session = resolveOrCreateRequestSession(request);
    const ids = new URL(request.url).searchParams.getAll("id").slice(0, 10);
    // Match the visible repository list, including blank-mode filtering, before returning any record.
    const visible = await (await getRideRepository()).listRides(session.userId);
    const rides = visible.sort((a, b) => (b.record.activity.startTime ?? "").localeCompare(a.record.activity.startTime ?? "")).filter(({ record }) => ids.includes(record.activity.rideId)).map(({ record }) => ({
      ...toCalendarRide(record),
      title: formatRideTitle(record.activity.startTime),
      heartRate: record.activity.metrics.avgHeartRateBpm !== undefined,
      power: record.activity.metrics.avgPowerW !== undefined,
    }));
    return Response.json({ rides }, { headers: { "Cache-Control": "no-store", ...sessionCookieHeader(session) } });
  } catch { return Response.json({ error: "记录暂时无法读取" }, { status: 503 }); }
}
