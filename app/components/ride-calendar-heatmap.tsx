"use client";

import { BottomSheet } from "./profile-sheet";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { calendarDate, calendarDuration, calendarHeatmapLayout, calendarNumber, calendarWeekStart, distanceHeatLevel, ridesByDate, shiftCalendarMonth, summarizeCalendarRides, type CalendarRide } from "../../src/ui/ride-calendar.ts";
import { isDemoImportedRideId } from "../../src/fixtures/demo-imported-ride-manifest.ts";
import { ArrowIcon, BikeIcon, UploadIcon } from "./icons";
import { PendingLink } from "./pending-link";
import styles from "./ride-calendar.module.css";

const timeFormatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function dateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return year + " 年 " + month + " 月 " + day + " 日";
}

// 热力图月份标签：只在 1 月补年份，跨年时不再出现两个同名「1 月」。
function monthLabel(month: string): string {
  const [year, value] = month.split("-").map(Number);
  return value === 1 ? year + " 年 1 月" : value + " 月";
}

type Summary = ReturnType<typeof summarizeCalendarRides>;

function distanceText(distanceM: number | null): string {
  return distanceM === null ? "未记录" : calendarNumber(distanceM / 1000) + " km";
}

// 汇总卡：与「骑行伙伴」对话页的 .chat-summary 保持同一套结构与单位写法
// （三列一行、标签在上、数值在下、单位跟随数值同一行），两处口径与字号不再分叉。
function SummaryCard({ total, week }: { total: Summary; week: Summary }) {
  return <div className={styles.summaryCard} aria-label="骑行汇总">
    <dl className={styles.summaryGrid}>
      <div><dt>累计骑行</dt><dd>{total.count} 次</dd></div>
      <div><dt>总里程</dt><dd>{distanceText(total.distanceM)}</dd></div>
      <div><dt>本周</dt><dd>{week.count} 次 · {distanceText(week.distanceM)}</dd></div>
    </dl>
  </div>;
}

function RideTimeline({ rides, onUpload }: { rides: CalendarRide[]; onUpload: () => void }) {
  const sorted = [...rides].sort((a, b) => {
    if (!a.startTime && !b.startTime) return (b.date ?? "").localeCompare(a.date ?? "");
    if (!a.startTime) return 1;
    if (!b.startTime) return -1;
    return b.startTime.localeCompare(a.startTime);
  });
  const groups = new Map<string, CalendarRide[]>();
  for (const ride of sorted) {
    const key = ride.date ?? "undated";
    groups.set(key, [...(groups.get(key) ?? []), ride]);
  }

  if (!sorted.length) return <div className={styles.emptyRecords}>
    <p>暂无记录，请上传</p>
    <button className={styles.uploadPill} onClick={onUpload}><UploadIcon />同步／导入</button>
  </div>;

  return <div className={styles.timeline}>
    <button className={styles.uploadPill} onClick={onUpload}><UploadIcon />同步／导入</button>
    {[...groups.entries()].map(([date, items]) => <section key={date} className={styles.timelineDay}>
      <h3>{date === "undated" ? "日期未记录" : dateLabel(date)}</h3>
      <div className={styles.timelineItems}>{items.map((ride) => {
        const facts = [ride.durationS === null ? null : calendarDuration(ride.durationS), ride.avgSpeedMps === null ? null : calendarNumber(ride.avgSpeedMps * 3.6) + " km/h", ride.elevationM === null ? null : "爬升 " + calendarNumber(ride.elevationM) + " m"].filter(Boolean);
        return <PendingLink key={ride.id} href={"/rides/" + ride.id} className={styles.rideCard}>
          <div className={styles.rideCardContent}>
            <div className={styles.rideCardTop}><span className={styles.rideIcon}><BikeIcon /></span><span className={styles.rideName}>骑行记录<span className={styles.rideMeta}><small>{ride.startTime ? timeFormatter.format(new Date(ride.startTime)) : "时间未记录"} · {ride.source}</small>{isDemoImportedRideId(ride.id) && <span className={styles.demoTag}>演示</span>}</span></span><ArrowIcon className={styles.cardArrow} /></div>
            <p className={styles.rideDistance}>{ride.distanceM === null ? <span className={styles.unrecorded}>距离未记录</span> : <>{calendarNumber(ride.distanceM / 1000)}<span>km</span></>}</p>
            {facts.length > 0 && <p className={styles.rideFacts}>{facts.join(" · ")}</p>}
          </div>
        </PendingLink>;
      })}</div>
    </section>)}
  </div>;
}

export function RideCalendar({ rides, initialToday, upload }: { rides: CalendarRide[]; initialToday: string; upload: ReactNode }) {
  const [today, setToday] = useState(initialToday);
  const scroller = useRef<HTMLDivElement>(null);
  const monthRefs = useRef(new Map<string, HTMLElement>());
  const [importOpen, setImportOpen] = useState(false);
  const groups = useMemo(() => ridesByDate(rides), [rides]);
  const total = summarizeCalendarRides(rides);
  const weekStart = calendarWeekStart(today);
  const weekRides = rides.filter((ride) => ride.date !== null && ride.date >= weekStart && ride.date <= today);
  const week = summarizeCalendarRides(weekRides);
  const currentMonth = today.slice(0, 7);
  // 起始月份：最早记录所在月再往前 12 个月，保留翻看更早记录的空间；
  // 日期截止当天，跨月保持连续；未来日期不生成格子。
  const earliestRideMonth = rides.map((ride) => (ride.date ? ride.date.slice(0, 7) : null)).filter((value): value is string => Boolean(value)).sort()[0];
  const firstMonth = shiftCalendarMonth(earliestRideMonth && earliestRideMonth < currentMonth ? earliestRideMonth : currentMonth, -12);
  const heatmap = useMemo(() => calendarHeatmapLayout(firstMonth, currentMonth, today), [firstMonth, currentMonth, today]);

  // 初始定位：把「本月」对齐到热力图条带最左侧。直接改 scrollLeft（不用 smooth），
  // 并在首帧、双 rAF、字体就绪后各对齐一次，避免首屏偏移。
  useEffect(() => {
    const container = scroller.current;
    if (!container) return;
    let frame = 0;
    const align = () => {
      const node = monthRefs.current.get(currentMonth);
      if (!node || !container) return;
      const delta = node.getBoundingClientRect().left - container.getBoundingClientRect().left;
      if (Math.abs(delta) > 0.5) container.scrollLeft += delta;
    };
    align();
    frame = window.requestAnimationFrame(() => {
      align();
      frame = window.requestAnimationFrame(align);
    });
    void document.fonts?.ready.then(align);
    return () => window.cancelAnimationFrame(frame);
  }, [currentMonth]);

  useEffect(() => {
    const update = () => setToday(calendarDate(new Date().toISOString()) ?? initialToday);
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [initialToday]);

  return <div className={`${styles.page} ride-route-enter`}>
    <section className={styles.overviewCard} aria-label="骑行汇总与月度热力图">
      <SummaryCard total={total} week={week} />
      <div className={styles.heatmapCard} aria-label="月度骑行热力图">
        <div ref={scroller} className={styles.heatmapScroller} tabIndex={0} role="group" aria-label="按日连续排列、可左右滑动的骑行热力图">
          <div className={styles.heatmapTrack}>
            {heatmap.days.map((date, index) => {
              const entries = groups.get(date) ?? [];
              const daySummary = summarizeCalendarRides(entries);
              const label = dateLabel(date) + "，" + entries.length + " 次骑行" + (daySummary.distanceM === null ? "，距离未记录" : "，" + calendarNumber(daySummary.distanceM / 1000) + " 公里");
              return <span key={date} className={styles.dayCell} role="img" data-date={date} data-heat={distanceHeatLevel(entries)} style={{ gridColumn: Math.floor(index / 7) + 1, gridRow: index % 7 + 1 }} aria-label={label} title={label} />;
            })}
            {heatmap.months.map(({ month, column }) => <span key={month} ref={node => { if (node) monthRefs.current.set(month, node); else monthRefs.current.delete(month); }} className={styles.heatmapMonth} style={{ gridColumn: column, gridRow: 8 }}>{monthLabel(month)}</span>)}
          </div>
        </div>
      </div>
    </section>
    <section className={styles.recordsSection} aria-label="全部骑行记录">
      <RideTimeline rides={rides} onUpload={() => setImportOpen(true)} />
    </section>
    <BottomSheet open={importOpen} title="同步／导入骑行" onClose={() => setImportOpen(false)}>{upload}</BottomSheet>
  </div>;
}
