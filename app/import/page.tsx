import Link from "next/link";

import { AppShell } from "../components/app-shell";
import { BikeIcon } from "../components/icons";
import { RideSync } from "../components/ride-sync";
import { getNextSessionUserId } from "../../src/auth/next-session.ts";
import { getRideRepository } from "../../src/persistence/demo-ride-repository.ts";
import { RideCalendar } from "../components/ride-calendar-heatmap";
import { calendarDate, toCalendarRide } from "../../src/ui/ride-calendar.ts";
import styles from "../components/ride-calendar.module.css";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = (await searchParams).state ?? "empty";
  const userId = await getNextSessionUserId();
  // DEMO-IMPORTED-RIDES：无会话访客也传入空 ownerId（仓储里不存在该 owner，只会命中演示记录），
  // 因此首次打开链接的人立刻能看到演示「已导入」记录，而不必先自己导入一条。
  const importedRides = await (await getRideRepository()).listRides(userId ?? "");

  return (
    <AppShell active="rides">
      <header className={styles.pageHeader}>
        <Link href="/" className={`brand ${styles.pageIdentity}`} aria-label="返回首页">
          <span className="brand-mark"><BikeIcon /></span>
          <h1 className={styles.pageTitle}>骑行记录</h1>
        </Link>
        <nav className={styles.pageActions} aria-label="快捷入口">
          <Link className="eyebrow" href="/chat?recent=1">近期表现</Link>
          <Link className="eyebrow" href="/pmc" aria-label="PMC 表现状态管理">PMC</Link>
        </nav>
      </header>
      {state === "loading" && <div className="state-card" aria-live="polite"><span className="spinner" /><h2>正在读取记录</h2><p>基础事实会优先出现，不需要等待 AI。</p></div>}
      {state === "error" && <div className="state-card error-state" role="alert"><span>!</span><h2>文件暂时无法读取</h2><p>请确认文件完整，且格式为 FIT 或 GPX。你的文件没有上传给模型。</p><Link className="secondary-button" href="/import">重新选择</Link></div>}
      {state !== "loading" && state !== "error" && (
        <RideCalendar
          rides={importedRides.map(({ record }) => toCalendarRide(record))}
          initialToday={calendarDate(new Date().toISOString())!}
          upload={<RideSync />}
        />
      )}
    </AppShell>
  );
}
