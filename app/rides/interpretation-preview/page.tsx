import Link from "next/link";

import { AppShell } from "../../components/app-shell";
import { BackIcon } from "../../components/icons";
import { RideSeriesChart } from "../../components/ride-visuals";
import { projectRideInterpretationInputV04Candidate } from "../../../src/ai/ride-interpretation-input-v04-candidate";
import { buildRideInterpretationOutputV04CandidateFixture } from "../../../src/ai/ride-interpretation-output-v04-candidate";
import { buildRideInterpretationPlan } from "../../../src/ai/ride-interpretation-plan";
import { assembleRideInterpretationPresentationV04Candidate } from "../../../src/ai/ride-interpretation-presentation-v04-candidate";
import { buildRideInterpretationPresentationViewModelV04Candidate } from "../../../src/ai/ride-interpretation-presentation-view-model-v04-candidate";
import { buildAnalysisEligibility } from "../../../src/domain/analysis-eligibility";
import { buildRideAnalysisContext } from "../../../src/domain/ride-analysis-context";
import { createUserProfile } from "../../../src/domain/user-profile";
import { getRideFixture } from "../../../src/fixtures/rides";

const DIMENSION_LABELS: Record<string, string> = {
  route_pacing: "沿途节奏",
  terrain_climb: "地形与爬坡",
  heart_rate: "心率负荷",
  power_output: "功率输出",
  cadence: "踩踏表现",
  pacing_stability: "节奏稳定性",
};

function buildCandidate() {
  const fixture = getRideFixture("l3-power-preview");
  const record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  const context = buildRideAnalysisContext(record, {
    profile: createUserProfile({ age: 35, maxHeartRateBpm: 188, weightKg: 70, ftpWatts: 240 }, "2026-09-01T00:00:00.000Z"),
  });
  const plan = buildRideInterpretationPlan(context, buildAnalysisEligibility(context));
  const input = projectRideInterpretationInputV04Candidate(context, plan);
  if (!input) throw new Error("Candidate preview fixture did not produce an input");
  const output = buildRideInterpretationOutputV04CandidateFixture(input);
  const presentation = assembleRideInterpretationPresentationV04Candidate(output, input);
  const viewModel = buildRideInterpretationPresentationViewModelV04Candidate(record, presentation);
  return { output, presentation, viewModel };
}

export default function RideInterpretationPreviewPage() {
  const { output, presentation, viewModel } = buildCandidate();
  const rejected = viewModel.validationStatus !== "accepted" || !presentation.acceptedOutput;
  const blockVisuals = new Map(viewModel.renderedBlocks.map((block) => [block.blockId, block.visuals]));

  return (
    <AppShell active="rides">
      <div className="ride-detail-page ride-detail-preview-page">
        <header className="detail-nav">
          <Link className="icon-button" href="/rides/l3-power-preview?tab=analysis" aria-label="返回现有分析页"><BackIcon /></Link>
          <nav className="detail-tabs candidate-preview-tabs" aria-label="骑行记录详情" role="tablist">
            <Link href="/rides/l3-power-preview">摘要</Link>
            <Link className="active" href="/rides/interpretation-preview" aria-current="page">分析</Link>
            <Link href="/rides/l3-power-preview?tab=data">数据</Link>
          </nav>
          <span className="nav-spacer" aria-hidden="true" />
        </header>

        <div className="candidate-preview-content">
          <header className="candidate-preview-header">
            <p className="kicker">OFFLINE CANDIDATE · V0.4.1</p>
            <h1>骑后 AI 解读预览</h1>
          <p>基于脱敏内置样例，检查整体评价、多维度解读、表现高光和下一步建议的自然语言阅读顺序。</p>
          </header>

          <div className="candidate-preview-notice" role="status"><strong>离线候选预览</strong><span>不调用模型，不接 Coze，不代表生产输出。</span><code>{viewModel.viewModelVersion}</code></div>

          {rejected ? <section className="candidate-preview-rejected"><h2>候选输出已降级</h2><p>当前 fixture 未通过呈现校验，页面不会展示未经验证的 AI 文本或图表。</p><code>{viewModel.errorCodes.join(" · ") || "UNKNOWN"}</code></section> : <>
        <section className="candidate-label-band"><span>一句话标签</span><strong>{output.oneLineLabel.text}</strong></section>

        <section className="candidate-overall-section">
          <div className="candidate-section-heading"><p className="kicker">01 · OVERALL</p><h2>整体评价</h2></div>
          <p className="candidate-narrative">{output.overallAssessment.text}</p>
          <div className="candidate-evidence-strip">
            {blockVisuals.get("overall_assessment")?.map((binding) => <RideSeriesChart chart={binding.chart!} cruiseSegments={[]} key={binding.visualId} />)}
          </div>
          {output.highlights.length > 0 && <div className="candidate-highlights"><h3>表现高光</h3><ul>{output.highlights.map((highlight, index) => <li key={`highlight-${index}`}>{highlight.text}</li>)}</ul></div>}
        </section>

        <section className="candidate-dimensions-section">
          <div className="candidate-section-heading"><p className="kicker">02 · DIMENSIONS</p><h2>重点维度</h2><span>{output.dimensions.length} 个</span></div>
          <div className="candidate-dimension-grid">
            {output.dimensions.map((dimension) => {
              const block = viewModel.renderedBlocks.find((item) => item.blockId === `dimension:${dimension.dimensionId}`);
              return <article className="candidate-dimension" key={dimension.dimensionId}>
                <header><h3>{DIMENSION_LABELS[dimension.dimensionId] ?? dimension.dimensionId}</h3></header>
                <p className="candidate-narrative">{dimension.text}</p>
                {block && block.visuals.length > 0 && <div className="candidate-dimension-chart">{block.visuals.map((binding) => <RideSeriesChart chart={binding.chart!} cruiseSegments={[]} key={binding.visualId} />)}</div>}
                {output.limitations.filter((limitation) => limitation.dimensionId === dimension.dimensionId).map((limitation) => <p className="candidate-limitation" key={limitation.dimensionId}>该维度保留了确定性数据限制。</p>)}
              </article>;
            })}
          </div>
        </section>

        <section className="candidate-footer-section">
          <div><p className="kicker">03 · BOUNDARY</p><h2>限制与下一步</h2></div>
          {output.limitations.length > 0 && <ul>{output.limitations.map((limitation) => <li key={limitation.dimensionId}>{DIMENSION_LABELS[limitation.dimensionId] ?? limitation.dimensionId}：已保留确定性限制。</li>)}</ul>}
          {output.nextAction && <p className="candidate-next-action"><span>{output.nextAction.kind === "grounded" ? "基于本次证据" : "通用建议"}</span>{output.nextAction.text}</p>}
          {output.limitations.length === 0 && !output.nextAction && <p className="candidate-muted">当前 fixture 没有需要额外展示的限制或行动建议。</p>}
        </section>
          </>}
        </div>
      </div>
    </AppShell>
  );
}
