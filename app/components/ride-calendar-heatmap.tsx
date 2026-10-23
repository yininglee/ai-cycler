"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { calendarDate, calendarDuration, calendarMonthDates, calendarNumber, distanceHeatLevel, ridesByDate, shiftCalendarMonth, summarizeCalendarRides, type CalendarRide } from "../../src/ui/ride-calendar.ts";
import { isDemoImportedRideId } from "../../src/fixtures/demo-imported-ride-manifest.ts";
import { ArrowIcon, BackIcon, BikeIcon, UploadIcon } from "./icons";
import { PendingLink } from "./pending-link";
import styles from "./ride-calendar.module.css";

const heatLabels = ["无骑行", "不足 20 km", "20–49.9 km", "50–99.9 km", "100 km 及以上"];
const timeFormatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function dateLabel(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return month + " 月 " + day + " 日";
}

function RideCards({ rides }: { rides: CalendarRide[] }) {
  return <div className={styles.rideList}>{rides.map((ride) => {
    const facts = [ride.durationS === null ? null : calendarDuration(ride.durationS), ride.avgSpeedMps === null ? null : calendarNumber(ride.avgSpeedMps * 3.6) + " km/h", ride.elevationM === null ? null : "爬升 " + calendarNumber(ride.elevationM) + " m"].filter(Boolean);
    return <PendingLink key={ride.id} href={"/rides/" + ride.id} transitionKey="ride-detail" className={styles.rideCard}>
      <div className={styles.rideCardTop}><span className={styles.rideIcon}><BikeIcon /></span><span className={styles.rideName}>{ride.date ? dateLabel(ride.date) + "骑行" : "骑行记录"}<small>{ride.date && ride.startTime ? timeFormatter.format(new Date(ride.startTime)) : "日期未记录"} · {ride.source}{isDemoImportedRideId(ride.id) ? " · 演示" : ""}</small></span><ArrowIcon className={styles.cardArrow} /></div>
      <p className={styles.rideDistance}>{ride.distanceM === null ? <span className={styles.unrecorded}>距离未记录</span> : <>{calendarNumber(ride.distanceM / 1000)}<span>km</span></>}</p>
      {facts.length > 0 && <p className={styles.rideFacts}>{facts.join(" · ")}</p>}
    </PendingLink>;
  })}</div>;
}

export function RideCalendar({ rides, initialToday, upload, extra }: { rides: CalendarRide[]; initialToday: string; upload: ReactNode; extra: ReactNode }) {
  const [today, setToday] = useState(initialToday);
  const [month, setMonth] = useState(initialToday.slice(0, 7));
  const [selected, setSelected] = useState(initialToday);
  const [popover, setPopover] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const calendarSection = useRef<HTMLElement>(null);
  const monthRefs = useRef(new Map<string, HTMLElement>());
  const dialog = useRef<HTMLDialogElement>(null);
  const groups = useMemo(() => ridesByDate(rides), [rides]);
  const monthRides = rides.filter((ride) => ride.date?.startsWith(month + "-"));
  const summary = summarizeCalendarRides(monthRides);
  const dailyRides = groups.get(selected) ?? [];
  const undatedRides = rides.filter((ride) => !ride.date);
  const latestDate = [...groups.keys()].sort().at(-1);
  const monthNumber = Number(month.slice(5, 7));
  const earliestRideMonth = rides.map((ride) => ride.date?.slice(0, 7)).filter((value): value is string => Boolean(value)).sort()[0];
  const firstMonth = earliestRideMonth ? shiftCalendarMonth(earliestRideMonth, -12) : shiftCalendarMonth(initialToday.slice(0, 7), -12);
  const lastMonth = shiftCalendarMonth(initialToday.slice(0, 7), 12);
  const months: string[] = [];
  for (let item = firstMonth; item <= lastMonth; item = shiftCalendarMonth(item, 1)) months.push(item);

  useEffect(() => {
    const node = monthRefs.current.get(initialToday.slice(0, 7));
    if (node && scroller.current) scroller.current.scrollLeft = node.getBoundingClientRect().left - scroller.current.getBoundingClientRect().left + scroller.current.scrollLeft;
    const update = () => setToday(calendarDate(new Date().toISOString()) ?? initialToday);
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [initialToday]);

  useEffect(() => {
    if (!popover) return;
    const dismiss = (event: PointerEvent) => { if (!calendarSection.current?.contains(event.target as Node)) setPopover(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setPopover(false); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [popover]);

  function scrollToMonth(value: string): void {
    const node = monthRefs.current.get(value);
    if (node && scroller.current) scroller.current.scrollTo({ left: node.getBoundingClientRect().left - scroller.current.getBoundingClientRect().left + scroller.current.scrollLeft, behavior: "smooth" });
    setMonth(value);
  }

  function selectDate(date: string): void {
    setSelected(date);
    setMonth(date.slice(0, 7));
    setPopover(false);
    scrollToMonth(date.slice(0, 7));
  }

  function navigateMonth(value: string): void {
    setSelected(value === today.slice(0, 7) ? today : value + "-01");
    setPopover(false);
    scrollToMonth(value);
  }

  const selectedRides = groups.get(selected) ?? [];
  return <div className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>每一次出发，都有迹可循</p><h1>骑行日历<span>.</span></h1></div><button className={styles.importButton} onClick={() => dialog.current?.showModal()}><UploadIcon /><span>导入</span></button></header>
    <section ref={calendarSection} className={styles.calendarSection} aria-label="月度骑行热力图">
      <div className={styles.monthHeader}><h2 aria-live="polite"><span>{Number(month.slice(0, 4))} 年</span>{monthNumber} 月</h2><div className={styles.monthActions}>
        <button className={styles.todayButton} onClick={() => selectDate(today)}>今天</button>
        <button className={styles.iconButton} aria-label="上个月" onClick={() => navigateMonth(shiftCalendarMonth(month, -1))}><BackIcon /></button>
        <button className={styles.iconButton} aria-label="下个月" onClick={() => navigateMonth(shiftCalendarMonth(month, 1))}><BackIcon className={styles.nextIcon} /></button>
      </div></div>
      <div ref={scroller} className={styles.heatmapScroller} onScroll={(event) => {
        const viewport = event.currentTarget;
        let current = months[0];
        for (const value of months) {
          const node = monthRefs.current.get(value);
          if (node && node.getBoundingClientRect().left - viewport.getBoundingClientRect().left <= 8) current = value;
        }
        if (current && current !== month) setMonth(current);
      }}>
        <div className={styles.heatmapTrack}>{months.map((value) => {
          const dates = calendarMonthDates(value);
          return <section key={value} ref={(node) => { if (node) monthRefs.current.set(value, node); else monthRefs.current.delete(value); }} className={styles.heatmapMonth} aria-label={Number(value.slice(5, 7)) + " 月热力图"}>
            <h3>{Number(value.slice(5, 7))} 月</h3>
            <div className={styles.monthSquares}>{dates.map((date) => {
              const entries = groups.get(date) ?? [];
              const daySummary = summarizeCalendarRides(entries);
              const isToday = date === today;
              const isSelected = date === selected;
              return <div key={date} className={styles.dayCell}><button
                className={styles.day + (isSelected ? " " + styles.selected : "")}
                data-heat={distanceHeatLevel(entries)} data-date={date}
                aria-pressed={isSelected} aria-current={isToday ? "date" : undefined}
                aria-label={date.replaceAll("-", " 年 ").replace(/ 年 (\d+)$/, " 月 $1 日") + (isToday ? "，今天" : "") + "，" + entries.length + " 次骑行" + (daySummary.distanceM === null ? "，距离未记录" : "，" + calendarNumber(daySummary.distanceM / 1000) + " 公里")}
                aria-expanded={isSelected && popover} aria-controls={isSelected && popover ? "ride-day-popover" : undefined}
                onClick={() => { setSelected(date); setMonth(value); setPopover(true); }}
              >{isToday && <span className={styles.todayDot} aria-hidden="true" />}</button>
              </div>;
            })}</div>
          </section>;
        })}</div>
      </div>
      {popover && <div id="ride-day-popover" role="region" aria-label={dateLabel(selected) + "骑行摘要"} className={styles.popover}>
        <div className={styles.popoverHeading}><strong>{dateLabel(selected)}{selected === today ? " · 今天" : ""}</strong><button className={styles.closeButton} aria-label="关闭日期摘要" onClick={() => setPopover(false)}>×</button></div>
        <p>{selectedRides.length} 次骑行</p>{selectedRides.length ? <ul>{selectedRides.map((ride, i) => <li key={ride.id}><span>第 {i + 1} 次</span><strong>{ride.distanceM === null ? "距离未记录" : calendarNumber(ride.distanceM / 1000) + " km"}</strong></li>)}</ul> : <span className={styles.popoverEmpty}>这一天还没有骑行记录</span>}
      </div>}
      <div className={styles.calendarFooter}><span className={styles.todayKey}><i /> 今天</span><div className={styles.legend} aria-label="颜色越深，累计骑行距离越长"><span>距离</span><span>少</span>{heatLabels.map((label, level) => <i key={level} data-heat={level} title={label} aria-label={label} />)}<span>多</span></div></div>
      <div className={styles.calendarHint}><span>点击方格，查看当天骑行。</span>{latestDate && <button onClick={() => selectDate(latestDate)}>最近骑行 <ArrowIcon /></button>}</div>
    </section>
    <section className={styles.monthSummary} aria-labelledby="month-summary-title"><div className={styles.summaryHeading}><h2 id="month-summary-title">{month === today.slice(0, 7) ? "本月骑行" : monthNumber + " 月骑行"}</h2><span>{monthNumber} 月 1 日 — {new Date(Date.UTC(Number(month.slice(0, 4)), monthNumber, 0)).getUTCDate()} 日</span></div>
      <div className={styles.summaryGrid}><div className={styles.totalDistance}><span>累计距离</span><p>{summary.distanceM === null ? "未记录" : <>{calendarNumber(summary.distanceM / 1000)}<small>km</small></>}</p></div><div><span>骑行次数</span><p>{summary.count}<small>次</small></p></div><div><span>骑行时长</span><p className={styles.duration}>{summary.durationS === null ? "未记录" : calendarDuration(summary.durationS)}</p></div><div><span>累计爬升</span><p>{summary.elevationM === null ? "未记录" : <>{calendarNumber(summary.elevationM)}<small>m</small></>}</p></div></div>
      {summary.partial && <p className={styles.partialNote}>部分记录缺少指标，汇总仅包含已记录的数据。</p>}
    </section>
    <section className={styles.dailySection} aria-labelledby="daily-rides-title"><div className={styles.dailyHeading}><div><p>{selected === today ? dateLabel(today) : Number(selected.slice(0, 4)) + " 年"}</p><h2 id="daily-rides-title">{selected === today ? "今日骑行" : dateLabel(selected) + "的骑行"}</h2></div><span>{selectedRides.length} 条记录</span></div>
      <p className="sr-only" role="status">{dateLabel(selected)}，共 {selectedRides.length} 条骑行记录</p>{selectedRides.length ? <RideCards rides={selectedRides} /> : <div className={styles.emptyDay}><span className={styles.emptyIcon}><BikeIcon /></span><h3>{selected === today ? "今天还没有骑行记录" : "这一天没有骑行记录"}</h3><p>每一段骑行，都值得被记下。</p><button onClick={() => dialog.current?.showModal()}>导入一条骑行 <ArrowIcon /></button></div>}
    </section>
    {undatedRides.length > 0 && <section className={styles.undated}><h2>日期未记录</h2><p>以下记录缺少有效日期，暂未计入热力图。</p><RideCards rides={undatedRides} /></section>}
    <div className={styles.extra}>{extra}</div>
    <dialog ref={dialog} aria-labelledby="ride-import-title" className={styles.importDialog} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}><div className={styles.dialogHeader}><h2 id="ride-import-title">记录一次出发</h2><button className={styles.iconButton} aria-label="关闭导入" onClick={() => dialog.current?.close()}>×</button></div>{upload}</dialog>
  </div>;
}
