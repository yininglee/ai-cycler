// S6-04: renders a V2 output presentation (src/ai/ride-output-presentation-v2.ts)
// using the shared candidate-preview styles. Pure presentational component —
// no hooks, no data fetching — so it works in the offline fixture-driven
// preview page now and inside the client InterpretationView after S6-03
// wires the production API. Optional sections (highlights, history
// comparison, long-term load & recovery, suggestions) render only when the
// model delivered them; omitted dimensions are not fabricated.
//
// Knowledge references render as numbered superscript markers on the
// assertion text, with the resolved source entries listed at the very
// bottom of the page (user decision 2026-10-06: no conclusion-type labels).

import type {
  RideOutputPresentationAssertionV2,
  RideOutputPresentationV2,
} from "../../src/ai/ride-output-presentation-v2";
import type { RideSeriesChartDisplay } from "../../src/ui/ride-series-view-model";
import { RideSeriesChart } from "./ride-visuals";

function AssertionText({
  assertion,
  className = "v2-assertion-text",
}: {
  assertion: RideOutputPresentationAssertionV2;
  className?: string;
}) {
  return (
    <p className={className}>
      {assertion.text}
      {assertion.knowledgeFootnoteNumbers.map((number) => (
        <sup className="v2-footnote-mark" key={number}>
          [{number}]
        </sup>
      ))}
    </p>
  );
}

function AssertionList({ assertions }: { assertions: RideOutputPresentationAssertionV2[] }) {
  return (
    <ul className="v2-assertion-list">
      {assertions.map((assertion, index) => (
        <li key={`assertion-${index}`}>
          <AssertionText assertion={assertion} />
        </li>
      ))}
    </ul>
  );
}

export function RideOutputV2View({
  presentation,
  charts,
}: {
  presentation: RideOutputPresentationV2;
  // S6-03 deterministic chart binding (user decision 2026-10-06): the server
  // binds each dimension to its sensor chart by fixed rules; the model never
  // declares chart references.
  charts?: Record<string, RideSeriesChartDisplay>;
}) {
  const dimensionCount =
    presentation.dimensions.length + (presentation.longTermLoadRecovery ? 1 : 0);

  return (
    <div className="v2-output">
      {presentation.repairOutcomeLabel && (
        <div className="v2-repair-note" role="status">
          <strong>修复留痕</strong>
          <span>{presentation.repairOutcomeLabel}——展示前已通过完整重验。</span>
        </div>
      )}

      <section className="candidate-label-band">
        <span>一句话标签</span>
        <strong>{presentation.label.text}</strong>
      </section>

      <section className="candidate-overall-section">
        <div className="candidate-section-heading">
          <p className="kicker">01 · OVERALL</p>
          <h2>整体评价</h2>
        </div>
        <AssertionText assertion={presentation.overallAssessment} className="candidate-narrative" />
        {presentation.highlights && (
          <div className="candidate-highlights">
            <h3>表现高光</h3>
            <AssertionList assertions={presentation.highlights} />
          </div>
        )}
      </section>

      <section className="candidate-dimensions-section">
        <div className="candidate-section-heading">
          <p className="kicker">02 · DIMENSIONS</p>
          <h2>各维度解读</h2>
          <span>{dimensionCount} 个</span>
        </div>
        <div className="candidate-dimension-grid">
          {presentation.dimensions.map((dimension) => (
            <article className="candidate-dimension" key={dimension.dimensionId}>
              <header>
                <h3>{dimension.title}</h3>
              </header>
              <AssertionList assertions={dimension.assertions} />
              {charts?.[dimension.dimensionId] && (
                <div className="candidate-dimension-chart">
                  <RideSeriesChart chart={charts[dimension.dimensionId]} cruiseSegments={[]} />
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      {presentation.historyComparison && (
        <section className="candidate-overall-section">
          <div className="candidate-section-heading">
            <p className="kicker">03 · HISTORY</p>
            <h2>相对过去的表现</h2>
          </div>
          <AssertionText assertion={presentation.historyComparison} className="candidate-narrative" />
        </section>
      )}

      {presentation.longTermLoadRecovery && (
        <section className="candidate-overall-section">
          <div className="candidate-section-heading">
            <p className="kicker">04 · LOAD &amp; RECOVERY</p>
            <h2>长期负荷与恢复</h2>
            <span>仅信号，不做恢复状态断言</span>
          </div>
          <AssertionList assertions={presentation.longTermLoadRecovery.assertions} />
        </section>
      )}

      {presentation.suggestions && (
        <section className="candidate-overall-section">
          <div className="candidate-section-heading">
            <p className="kicker">05 · NEXT</p>
            <h2>建议</h2>
            <span>{presentation.suggestions.length} 条</span>
          </div>
          <ul className="v2-assertion-list">
            {presentation.suggestions.map((suggestion, index) => (
              <li key={`suggestion-${index}`}>
                <AssertionText assertion={suggestion} />
                {suggestion.riskNote && (
                  <p className="v2-suggestion-risk">风险提示：{suggestion.riskNote}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="candidate-footer-section">
        <div className="candidate-section-heading">
          <p className="kicker">06 · BOUNDARY</p>
          <h2>限制与数据声明</h2>
        </div>
        {presentation.limitations.length > 0 ? (
          <ul className="v2-limitation-list">
            {presentation.limitations.map((limitation, index) => (
              <li key={`limitation-${index}`}>{limitation}</li>
            ))}
          </ul>
        ) : (
          <p className="candidate-muted">本次解读没有需要回填的数据限制。</p>
        )}
      </section>

      {presentation.knowledgeFootnotes.length > 0 && (
        <section className="candidate-footer-section v2-knowledge-sources">
          <div className="candidate-section-heading">
            <p className="kicker">07 · SOURCES</p>
            <h2>知识出处</h2>
          </div>
          <ol className="v2-footnote-list">
            {presentation.knowledgeFootnotes.map((footnote) => (
              <li key={footnote.knowledgeId} value={footnote.number}>
                {footnote.title}
              </li>
            ))}
          </ol>
        </section>
      )}

    </div>
  );
}

// Degraded display reusing the production fallback contract (business rules
// 14.6: failed outputs never render model text — b0 summary or safety stop).
export function RideOutputV2DegradedView({
  mode,
  fallbackCode,
}: {
  mode: "b0" | "safety_stop";
  fallbackCode?: string;
}) {
  return (
    <section className="candidate-preview-rejected">
      <h2>{mode === "b0" ? "本次解读已降级为确定性摘要" : "本次解读已安全停机"}</h2>
      <p>
        {mode === "b0"
          ? "AI 解读未通过独立校验，已按降级合同展示确定性摘要；详情页数据不受影响。"
          : "检测到不可安全展示的内容，本次不展示任何模型生成文本；详情页数据不受影响。"}
      </p>
      {fallbackCode && <code>{fallbackCode}</code>}
    </section>
  );
}
