import Link from "next/link";

import { AppShell, Brand } from "../components/app-shell";
import { ArrowIcon, CheckIcon } from "../components/icons";
import { RideFileUpload } from "../components/ride-file-upload";
import { getNextSessionUserId } from "../../src/auth/next-session.ts";
import { getApplicationRepository } from "../../src/persistence/application-repository.ts";
import type { MetricKey, RideRecord } from "../../src/domain/ride-schema.ts";

const samples = [
  { id: "l1-built-in-sample", capability: "轨迹", title: "只有轨迹", note: "距离、时间、速度、爬升" },
  { id: "l2-built-in-sample", capability: "心率", title: "包含心率", note: "在基础数据上增加心率" },
  { id: "l3-power-preview", capability: "功率", title: "包含功率", note: "在心率上增加完整功率数据" },
] as const;

function formatNumber(value: number, digits = 1): string {
  return Number(value.toFixed(digits)).toString();
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder} 分钟`;
  return remainder === 0 ? `${hours} 小时` : `${hours} 小时 ${remainder} 分钟`;
}

function formatRideDate(startTime: string | undefined): string | undefined {
  if (!startTime || Number.isNaN(Date.parse(startTime))) return undefined;
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric" }).format(new Date(startTime));
}

function formatRideTitle(startTime: string | undefined): string {
  if (!startTime || Number.isNaN(Date.parse(startTime))) return "骑行记录";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(new Date(startTime)) + "骑行";
}

function metricLabel(record: RideRecord, key: MetricKey): string | undefined {
  const value = record.activity.metrics[key]?.value;
  if (value === undefined || !Number.isFinite(value)) return undefined;
  if (key === "distanceM") return `${formatNumber(value / 1_000)} km`;
  if (key === "movingTimeS" || key === "elapsedTimeS") return formatDuration(value);
  if (key === "avgSpeedMps" || key === "maxSpeedMps") return `${formatNumber(value * 3.6)} km/h`;
  if (key === "elevationGainM") return `${Math.round(value)} m`;
  return undefined;
}

function privateRideSummary(record: RideRecord): string {
  return [
    metricLabel(record, "distanceM"),
    metricLabel(record, "movingTimeS") ?? metricLabel(record, "elapsedTimeS"),
    metricLabel(record, "avgSpeedMps"),
  ].filter(Boolean).join(" · ") || "已导入，暂无可显示的核心指标";
}

function sourceLabel(record: RideRecord): string {
  return record.activity.source.kind.toUpperCase();
}

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = (await searchParams).state ?? "empty";
  const userId = await getNextSessionUserId();
  const privateRides = userId ? await getApplicationRepository().listRides(userId) : [];

  return (
    <AppShell active="rides">
      <header className="topbar"><Brand /><span className="step-pill">1 / 3</span></header>
      <section className="page-intro">
        <p className="kicker">选择记录</p>
        <h1>从一条真实骑行开始。</h1>
        <p className="lead">导入一条 FIT 或 GPX，先查看可靠的骑行事实，再按需获取 AI 解读。</p>
      </section>

      {state === "loading" && <div className="state-card" aria-live="polite"><span className="spinner" /><h2>正在读取记录</h2><p>基础事实会优先出现，不需要等待 AI。</p></div>}
      {state === "error" && <div className="state-card error-state" role="alert"><span>!</span><h2>文件暂时无法读取</h2><p>请确认文件完整，且格式为 FIT 或 GPX。你的文件没有上传给模型。</p><Link className="secondary-button" href="/import">重新选择</Link></div>}
      {state !== "loading" && state !== "error" && (
        <>
          <RideFileUpload />

          {userId && <section className="section-block imported-rides-block" aria-labelledby="imported-rides-title">
            <div className="section-heading"><div><p className="kicker">我的记录</p><h2 id="imported-rides-title">已导入记录</h2></div><span className="private-count">{privateRides.length} 条</span></div>
            {privateRides.length > 0 ? <div className="sample-list">
              {privateRides.map(({ record }) => <Link key={record.activity.rideId} className="sample-card private-ride-card" href={`/rides/${record.activity.rideId}`}>
                <span className="level-badge private-level-badge">{sourceLabel(record)}</span>
                <div><p className="private-ride-date">{formatRideDate(record.activity.startTime) ?? "无日期"}</p><h3>{formatRideTitle(record.activity.startTime)}</h3><p>{privateRideSummary(record)}</p></div>
                <ArrowIcon />
              </Link>)}
            </div> : <div className="private-empty"><p>还没有导入记录</p><span>选择上方的 FIT 或 GPX 文件，导入后会出现在这里。</span></div>}
          </section>}

          <section className="section-block">
            <div className="section-heading"><div><p className="kicker">立即体验</p><h2>选择示例记录</h2></div></div>
            <div className="sample-list">
              {samples.map((sample) => <Link key={sample.id} className="sample-card" href={`/rides/${sample.id}`}><span className="level-badge">{sample.capability}</span><div><h3>{sample.title}</h3><p>{sample.note}</p></div><ArrowIcon /></Link>)}
            </div>
          </section>

          <details className="state-preview"><summary>预览异常与降级状态</summary><div className="state-links"><Link href="/rides/gpx-no-timestamps"><CheckIcon />GPX 无时间戳</Link><Link href="/rides/fit-truncated-file">! FIT 文件损坏</Link><Link href="/import?state=loading">加载状态</Link><Link href="/import?state=error">错误状态</Link></div></details>
        </>
      )}
    </AppShell>
  );
}
