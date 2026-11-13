import Link from "next/link";

import { RideSync } from "../components/ride-sync";
import { getNextSessionUserId } from "../../src/auth/next-session.ts";
import { getRideRepository } from "../../src/persistence/demo-ride-repository.ts";
import { RideCalendar } from "../components/ride-calendar-heatmap";
import { calendarDate, toCalendarRide } from "../../src/ui/ride-calendar.ts";
import ImportLoading from "./loading";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = (await searchParams).state ?? "empty";
  if (state === "loading") return <ImportLoading />;
  if (state === "error") return <div className="state-card error-state" role="alert"><span>!</span><h2>文件暂时无法读取</h2><p>请确认文件完整，且格式为 FIT 或 GPX。你的文件没有上传给模型。</p><Link className="secondary-button" href="/import">重新选择</Link></div>;
  const userId = await getNextSessionUserId();
  // DEMO-IMPORTED-RIDES：无会话访客也传入空 ownerId（仓储里不存在该 owner，只会命中演示记录），
  // 因此首次打开链接的人立刻能看到演示「已导入」记录，而不必先自己导入一条。
  const importedRides = await (await getRideRepository()).listRides(userId ?? "");

  return <RideCalendar
    rides={importedRides.map(({ record }) => toCalendarRide(record))}
    initialToday={calendarDate(new Date().toISOString())!}
    upload={<RideSync />}
  />;
}
