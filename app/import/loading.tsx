import { RouteProgress } from "../components/route-loading";
import styles from "../components/ride-calendar.module.css";

export default function ImportLoading() {
  return <div className={styles.page} data-route-loading="rides">
    <div className={styles.overviewCard}>
      <RouteProgress label="正在读取骑行记录" />
      <div className={styles.summaryCard} aria-hidden="true">
        <div className={styles.summaryGrid}>
          {["累计骑行", "总里程", "本周"].map(label => <div key={label}><span className="route-skeleton-line" /><span className="route-skeleton-line route-skeleton-line-wide" /></div>)}
        </div>
      </div>
      <div className={styles.heatmapCard} aria-hidden="true"><div className={styles.heatmapPlaceholder} /></div>
    </div>
    <div className={styles.recordsSection} aria-hidden="true"><div className={`${styles.rideCard} ${styles.ridePlaceholder}`} /></div>
  </div>;
}
