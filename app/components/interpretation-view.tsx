"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { recordDemoEvent } from "./demo-event-client";
import { RideSeriesChart } from "./ride-visuals";
import type {
  RideInterpretationOutputV04Candidate,
} from "../../src/ai/ride-interpretation-output-v04-candidate";
import type {
  RideInterpretationPresentationV04Candidate,
} from "../../src/ai/ride-interpretation-presentation-v04-candidate";
import type {
  RideInterpretationPresentationViewModelV04Candidate,
} from "../../src/ai/ride-interpretation-presentation-view-model-v04-candidate";

interface InterpretationResponse {
  rideId: string;
  source: "b2" | "b0" | "safety_stop";
  output: unknown;
  fallbackCode?: string;
  attempts?: number;
  validationIssues?: string[];
  v04Candidate?: {
    output: RideInterpretationOutputV04Candidate;
    presentation: RideInterpretationPresentationV04Candidate;
    viewModel: RideInterpretationPresentationViewModelV04Candidate;
  };
}

const DIMENSION_LABELS: Record<string, string> = {
  route_pacing: "沿途节奏",
  terrain_climb: "地形与爬坡",
  heart_rate: "心率负荷",
  power_output: "功率输出",
  cadence: "踩踏表现",
  pacing_stability: "节奏稳定性",
  history_change: "相对自己",
};

const EVENT_FALLBACK_CODES = new Set(["AI_DISABLED", "AI_NOT_CONFIGURED", "DATA_NOT_ELIGIBLE", "AI_TIMEOUT", "PROVIDER_ERROR", "REPAIR_FAILED"]);

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; data: InterpretationResponse }
  | { kind: "error"; message: string };

/**
 * Session-level cache for successful b2 responses, keyed by rideId only.
 *
 * The API always runs L6 plan in expanded mode (all eligible dimensions
 * narrated in one Provider call), per 骑后解读规则重构设计 §3.7 — the
 * drawer just decides how many to *display*. This means each rideId maps to
 * exactly one b2 response and the cache is a flat ride → response map.
 *
 * Each b2 call is a real Provider request (~15s, real cost), and the drawer
 * can be opened/closed repeatedly — cache hits make reopening instant.
 * b0 / safety_stop / errors are never cached.
 */
const responseCache = new Map<string, InterpretationResponse>();

/**
 * Default view shows the L6 plan's top 3 priority-ranked dimensions per
 * 骑后解读规则重构设计 §3.7 "默认展示三个维度，支持展开看到所有可解读的维度".
 * The LLM narrates all eligible dimensions up front; the cap is purely a UI
 * decision the user toggles without hitting the network.
 */
const DEFAULT_DIMENSION_DISPLAY_LIMIT = 3;

/**
 * Body of the AI ride interpretation drawer. Renders the
 * `/api/ride-analysis` v0.4 candidate output via the same view model that the
 * offline preview page (`interpretation-preview/page.tsx`) was validated with,
 * per 骑后解读规则重构设计 §6.1. Mounted inside `InterpretationSheet` by
 * `RideAiAnalysis` on the detail page.
 */
export function InterpretationView({
  rideId,
  title,
  dateLabel,
}: {
  rideId: string;
  title: string;
  dateLabel?: string;
}) {
  const [state, setState] = useState<LoadState>(() => {
    const cached = responseCache.get(rideId);
    return cached ? { kind: "ok", data: cached } : { kind: "loading" };
  });
  const [feedback, setFeedback] = useState<"helpful" | "not_helpful" | null>(null);

  // M2 observability: fire b0_visible when a deterministic B0 fallback is
  // actually shown to the user inside the drawer. Matches the pre-drawer
  // behavior of the inline AI panel.
  useEffect(() => {
    if (state.kind === "ok" && state.data.source === "b0" && state.data.fallbackCode
      && EVENT_FALLBACK_CODES.has(state.data.fallbackCode)) {
      recordDemoEvent({ type: "b0_visible", rideId, code: state.data.fallbackCode as "AI_DISABLED" | "AI_NOT_CONFIGURED" | "DATA_NOT_ELIGIBLE" | "AI_TIMEOUT" | "PROVIDER_ERROR" | "REPAIR_FAILED" });
    }
  }, [state, rideId]);

  function submitFeedback(value: "helpful" | "not_helpful") {
    setFeedback(value);
    recordDemoEvent({ type: "feedback_submitted", rideId, feedback: value });
  }

  const load = useCallback(async (force = false) => {
    if (!force && responseCache.has(rideId)) {
      setState({ kind: "ok", data: responseCache.get(rideId)! });
      return;
    }
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/ride-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rideId }),
        cache: "no-store",
      });
      if (!response.ok) {
        const text = await response.text();
        setState({ kind: "error", message: `REQUEST_FAILED:${response.status} ${text.slice(0, 120)}` });
        return;
      }
      const data = (await response.json()) as InterpretationResponse;
      if (data.source === "b2" && data.v04Candidate) {
        responseCache.set(rideId, data);
      }
      setState({ kind: "ok", data });
    } catch (cause) {
      setState({
        kind: "error",
        message: cause instanceof Error ? cause.message : "UNKNOWN_NETWORK_ERROR",
      });
    }
  }, [rideId]);

  useEffect(() => {
    void load();
  }, [load]);

  const blockVisuals = useMemo(() => {
    if (state.kind !== "ok") return new Map<string, Array<{ visualId: string; chart?: unknown }>>();
    const vm = state.data.v04Candidate?.viewModel;
    if (!vm) return new Map();
    return new Map(
      vm.renderedBlocks.map((block) => [
        block.blockId,
        block.visuals,
      ]),
    );
  }, [state]);

  return (
    <div className="ride-detail-page ride-detail-preview-page">
      <div className="candidate-preview-content">
        <header className="candidate-preview-header">
          <p className="kicker">RIDE INSIGHT</p>
          <h1>{title || "AI 骑行解读"}</h1>
          <p>基于本次记录中的可靠证据生成的整体评价、重点维度解读、表现高光与下一步建议。{dateLabel ? `覆盖骑行日期 ${dateLabel}。` : ""}</p>
        </header>

        {state.kind === "loading" && (
          <div className="candidate-preview-notice" role="status">
            <strong>正在生成解读…</strong>
            <span>首次调用需进入生产链路，请稍候。</span>
          </div>
        )}

        {state.kind === "error" && (
          <section className="candidate-preview-rejected">
            <h2>解读暂时不可用</h2>
            <p>请求生产链路时出错，请稍后重试。</p>
            <code>{state.message}</code>
            <p style={{ marginTop: 12 }}>
              <button type="button" onClick={() => void load(true)} className="ride-ai-secondary-button">重试</button>
            </p>
          </section>
        )}

        {state.kind === "ok" && state.data.source === "safety_stop" && (
          <section className="candidate-preview-rejected">
            <h2>请优先确保人身安全</h2>
            <p>如有胸痛、呼吸困难、晕厥、意识异常或严重外伤，请立即联系当地急救或尽快就医。本次记录不再展开 AI 解读。</p>
            <code>SAFETY_STOP</code>
          </section>
        )}

        {state.kind === "ok" && state.data.source === "b0" && (
          <section className="candidate-preview-rejected">
            <h2>本次骑行暂未生成 AI 解读</h2>
            <p>当前证据不足以保证解读质量，先展示本次骑行的事实卡片与图表。</p>
            <code>{state.data.fallbackCode ?? "DATA_NOT_ELIGIBLE"}</code>
            <FeedbackButtons feedback={feedback} onSubmit={submitFeedback} />
          </section>
        )}

        {state.kind === "ok" && state.data.source === "b2" && state.data.v04Candidate && (
          <B2Body response={state.data} blockVisuals={blockVisuals} feedback={feedback} onFeedback={submitFeedback} />
        )}

        {state.kind === "ok" && state.data.source === "b2" && !state.data.v04Candidate && (
          <section className="candidate-preview-rejected">
            <h2>解读已生成但呈现失败</h2>
            <p>服务端返回了 b2 结果，但缺少 v04Candidate 呈现数据。请稍后重试或联系维护者。</p>
            <code>{state.data.validationIssues?.join(" · ") || "MISSING_V04_CANDIDATE"}</code>
          </section>
        )}
      </div>
    </div>
  );
}

function B2Body({
  response,
  blockVisuals,
  feedback,
  onFeedback,
}: {
  response: InterpretationResponse;
  blockVisuals: Map<string, Array<{ visualId: string; chart?: unknown }>>;
  feedback: "helpful" | "not_helpful" | null;
  onFeedback: (value: "helpful" | "not_helpful") => void;
}) {
  const candidate = response.v04Candidate;
  if (!candidate) return null;
  const { output, viewModel } = candidate;
  const rejected = viewModel.validationStatus !== "accepted" || !candidate.presentation.acceptedOutput;

  // showAllDimensions is a pure UI state — toggling it never hits the
  // network. The L6 expanded-mode response already contains narrative text
  // for every eligible dimension; we just slice the array on display.
  const [showAllDimensions, setShowAllDimensions] = useState(false);

  // Catalog order: priority-ranked eligible dimension list from L6 plan
  // (骑后解读规则重构设计 §3.7 "按目录顺序逐个展示"). The L7 output is also
  // produced in this order, but we re-sort defensively so LLM reorderings
  // never break the UI's display order.
  const catalogOrder = new Map<string, number>(
    viewModel.eligibleDimensionIds.map((id, index) => [id, index]),
  );
  const sortedDimensions = [...output.dimensions].sort((left, right) => {
    const leftIdx = catalogOrder.get(left.dimensionId);
    const rightIdx = catalogOrder.get(right.dimensionId);
    if (leftIdx === undefined && rightIdx === undefined) return 0;
    if (leftIdx === undefined) return 1;
    if (rightIdx === undefined) return -1;
    return leftIdx - rightIdx;
  });
  const totalCount = sortedDimensions.length;
  const visibleDimensions = showAllDimensions
    ? sortedDimensions
    : sortedDimensions.slice(0, DEFAULT_DIMENSION_DISPLAY_LIMIT);
  const canExpand = !showAllDimensions && totalCount > DEFAULT_DIMENSION_DISPLAY_LIMIT;
  const canCollapse = showAllDimensions && totalCount > DEFAULT_DIMENSION_DISPLAY_LIMIT;

  if (rejected) {
    return (
      <section className="candidate-preview-rejected">
        <h2>候选输出已降级</h2>
        <p>本次生产输出未通过呈现校验，页面不会展示未经验证的 AI 文本或图表。</p>
        <code>{viewModel.errorCodes.join(" · ") || "UNKNOWN"}</code>
      </section>
    );
  }

  return (
    <>
      <div className="candidate-preview-notice" role="status">
        <strong>本次 AI 解读</strong>
        <span>已基于生产链路 v0.4 候选链生成。</span>
        <code>{viewModel.viewModelVersion}</code>
      </div>

      <section className="candidate-label-band">
        <span>一句话标签</span>
        <strong>{output.oneLineLabel.text}</strong>
      </section>

      <section className="candidate-overall-section">
        <div className="candidate-section-heading"><p className="kicker">01 · OVERALL</p><h2>整体评价</h2></div>
        <p className="candidate-narrative">{output.overallAssessment.text}</p>
        <div className="candidate-evidence-strip">
          {blockVisuals.get("overall_assessment")?.map((binding) => (
            <RideSeriesChart chart={binding.chart as Parameters<typeof RideSeriesChart>[0]["chart"]} cruiseSegments={[]} key={binding.visualId} />
          ))}
        </div>
        {output.highlights.some((highlight) => highlight.target.kind === "overall") && (
          <div className="candidate-highlights">
            <h3>表现高光</h3>
            <ul>
              {output.highlights.map((highlight, index) =>
                highlight.target.kind === "overall"
                  ? <li key={`highlight-overall-${index}`}>{highlight.text}</li>
                  : null,
              )}
            </ul>
          </div>
        )}
      </section>

      <section className="candidate-dimensions-section">
        <div className="candidate-section-heading">
          <p className="kicker">02 · DIMENSIONS</p>
          <h2>{showAllDimensions ? "全部解读" : "重点维度"}</h2>
          <span>{visibleDimensions.length} 个{canExpand ? `，共 ${totalCount} 个` : ""}</span>
        </div>
        <div className="candidate-dimension-grid">
          {visibleDimensions.map((dimension) => {
            const block = viewModel.renderedBlocks.find((item) => item.blockId === `dimension:${dimension.dimensionId}`);
            return (
              <article className="candidate-dimension" key={dimension.dimensionId}>
                <header><h3>{DIMENSION_LABELS[dimension.dimensionId] ?? dimension.dimensionId}</h3></header>
                <p className="candidate-narrative">{dimension.text}</p>
                {block && block.visuals.length > 0 && (
                  <div className="candidate-dimension-chart">
                    {block.visuals
                      .filter((visual): visual is typeof visual & { chart: NonNullable<typeof visual.chart> } => Boolean(visual.chart))
                      .map((visual) => (
                        <RideSeriesChart chart={visual.chart} cruiseSegments={[]} key={visual.visualId} />
                      ))}
                  </div>
                )}
                {output.limitations.filter((limitation) => limitation.dimensionId === dimension.dimensionId).map((limitation) => (
                  <p className="candidate-limitation" key={limitation.dimensionId}>该维度保留了确定性数据限制。</p>
                ))}
              </article>
            );
          })}
        </div>
        {canExpand && (
          <div className="candidate-dimension-toggle">
            <button
              type="button"
              className="ride-ai-secondary-button candidate-dimension-toggle-button"
              onClick={() => setShowAllDimensions(true)}
            >
              展开全部 {totalCount - DEFAULT_DIMENSION_DISPLAY_LIMIT} 个维度
            </button>
            <p className="candidate-dimension-toggle-hint">展开仅展示本次已生成的剩余维度，不再调用服务。</p>
          </div>
        )}
        {canCollapse && (
          <div className="candidate-dimension-toggle">
            <button
              type="button"
              className="ride-ai-secondary-button candidate-dimension-toggle-button"
              onClick={() => setShowAllDimensions(false)}
            >
              收起 · 仅看重点 {DEFAULT_DIMENSION_DISPLAY_LIMIT} 个
            </button>
          </div>
        )}
      </section>

      <section className="candidate-footer-section">
        <div><p className="kicker">03 · BOUNDARY</p><h2>限制与下一步</h2></div>
        {output.limitations.length > 0 && (
          <ul>
            {output.limitations.map((limitation) => (
              <li key={limitation.dimensionId}>{DIMENSION_LABELS[limitation.dimensionId] ?? limitation.dimensionId}：已保留确定性限制。</li>
            ))}
          </ul>
        )}
        {output.nextAction && (
          <p className="candidate-next-action">
            <span>{output.nextAction.kind === "grounded" ? "基于本次证据" : "通用建议"}</span>
            {output.nextAction.text}
          </p>
        )}
        {output.limitations.length === 0 && !output.nextAction && (
          <p className="candidate-muted">本次骑行没有需要额外展示的限制或行动建议。</p>
        )}
      </section>

      <FeedbackButtons feedback={feedback} onSubmit={onFeedback} />
    </>
  );
}

function FeedbackButtons({ feedback, onSubmit }: { feedback: "helpful" | "not_helpful" | null; onSubmit: (value: "helpful" | "not_helpful") => void }) {
  return <div className="feedback-row">
    <p>{feedback ? "反馈已记录" : "这份解读有帮助吗？"}</p>
    <div>
      <button type="button" onClick={() => onSubmit("helpful")} disabled={feedback !== null}>有帮助</button>
      <button type="button" onClick={() => onSubmit("not_helpful")} disabled={feedback !== null}>待改进</button>
    </div>
  </div>;
}
