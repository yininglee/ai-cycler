import type { RideHistoryComparisonView } from "../../src/ui/ride-history-comparison.ts";

/**
 * MVP-REPEAT-01：与本人历史对比区块（确定性，无 AI 参与）。
 * 仅在存在可比指标时由详情页渲染；视图模型见 src/ui/ride-history-comparison.ts。
 */
export default function RideHistoryComparisonSection({ view }: { view: RideHistoryComparisonView }) {
  return (
    <section className="history-comparison" aria-label="与本人历史对比">
      <header>
        <div>
          <h2>与本人历史对比</h2>
          <p>{view.note}</p>
        </div>
      </header>
      {view.groups.map((group) => <div className="history-comparison-group" key={group.key}>
        <div className="history-group-heading">
          <h3>{group.title}</h3>
          <span>{group.caption}</span>
        </div>
        <div className="metric-list">
          {group.rows.map((row) => <article className="metric-row" key={row.metricKey}>
            <div>
              <p>{row.label}</p>
              <span>本次 {row.anchorDisplay} · 均值 {row.baselineDisplay} · {row.sampleCount} 条样本</span>
            </div>
            <strong>{row.changeDisplay}</strong>
          </article>)}
        </div>
      </div>)}
    </section>
  );
}
