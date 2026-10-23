import Link from "next/link";

import { AppShell } from "../components/app-shell";
import { ArrowIcon, CheckIcon } from "../components/icons";
import { PendingLink } from "../components/pending-link";
import { RideFileUpload } from "../components/ride-file-upload";
import { getNextSessionUserId } from "../../src/auth/next-session.ts";
import { getRideRepository } from "../../src/persistence/demo-ride-repository.ts";
import { RideCalendar } from "../components/ride-calendar-heatmap";
import { calendarDate, toCalendarRide } from "../../src/ui/ride-calendar.ts";

const samples = [
  { id: "l1-built-in-sample", capability: "轨迹", title: "只有轨迹", note: "距离、时间、速度、爬升" },
  { id: "l2-built-in-sample", capability: "心率", title: "包含心率", note: "在基础数据上增加心率" },
  { id: "l3-power-preview", capability: "功率", title: "包含功率", note: "在心率上增加完整功率数据" },
] as const;

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = (await searchParams).state ?? "empty";
  const userId = await getNextSessionUserId();
  // DEMO-IMPORTED-RIDES：无会话访客也传入空 ownerId（仓储里不存在该 owner，只会命中演示记录），
  // 因此首次打开链接的人立刻能看到演示「已导入」记录，而不必先自己导入一条。
  const importedRides = await (await getRideRepository()).listRides(userId ?? "");

  return (
    <AppShell active="rides">
      {state === "loading" && <div className="state-card" aria-live="polite"><span className="spinner" /><h2>正在读取记录</h2><p>基础事实会优先出现，不需要等待 AI。</p></div>}
      {state === "error" && <div className="state-card error-state" role="alert"><span>!</span><h2>文件暂时无法读取</h2><p>请确认文件完整，且格式为 FIT 或 GPX。你的文件没有上传给模型。</p><Link className="secondary-button" href="/import">重新选择</Link></div>}
      {state !== "loading" && state !== "error" && (
        <RideCalendar
          rides={importedRides.map(({ record }) => toCalendarRide(record))}
          initialToday={calendarDate(new Date().toISOString())!}
          upload={<RideFileUpload />}
          extra={<>
            <details>
              <summary>体验更多示例记录</summary>
              <div className="sample-list">
                {samples.map((sample) => <PendingLink key={sample.id} className="sample-card" href={`/rides/${sample.id}`} transitionKey="ride-detail"><span className="level-badge">{sample.capability}</span><div><h3>{sample.title}</h3><p>{sample.note}</p></div><ArrowIcon /></PendingLink>)}
              </div>
            </details>
          <details className="state-preview"><summary>预览异常与降级状态</summary><div className="state-links"><Link href="/rides/gpx-no-timestamps"><CheckIcon />GPX 无时间戳</Link><Link href="/rides/fit-truncated-file">! FIT 文件损坏</Link><Link href="/rides/l1-built-in-sample?ai=b0">! AI 降级到 B0</Link><Link href="/import?state=loading">加载状态</Link><Link href="/import?state=error">错误状态</Link></div></details>
          </>}
        />
      )}
    </AppShell>
  );
}
