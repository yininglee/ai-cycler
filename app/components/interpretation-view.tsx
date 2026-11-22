"use client";

import { StatusBadge } from "./status-badge";
import { useCallback, useEffect, useState } from "react";

import { hasInterpretationIdentity, interpretationFailureMessage } from "../../src/ui/ride-interpretation-response";
import { recordDemoEvent } from "./demo-event-client";
import { CheckIcon, SparkIcon } from "./icons";
import type { RideOutputPresentationV2 } from "../../src/ai/ride-output-presentation-v2";
import type { RideSeriesChartDisplay } from "../../src/ui/ride-series-view-model";
import { RideOutputV2View } from "./ride-output-v2-view";

interface InterpretationResponse {
  rideId: string;
  cached?: boolean;
  generatedAt?: string;
  source: "v2" | "b0" | "safety_stop";
  output: unknown;
  fallbackCode?: string;
  failureCodes?: string[];
  v2Candidate?: {
    presentation: RideOutputPresentationV2;
    charts: Record<string, RideSeriesChartDisplay>;
    stage: string;
    modelRepairCalls: number;
    versions: Record<string, unknown>;
  };
}

const EVENT_FALLBACK_CODES = new Set([
  "AI_DISABLED", "AI_NOT_CONFIGURED", "DATA_NOT_ELIGIBLE", "AI_TIMEOUT", "PROVIDER_ERROR", "REPAIR_FAILED",
  // S6-03 V2 classified provider/input failures surfaced as b0 fallback codes.
  "PROVIDER_AUTH_ERROR", "PROVIDER_RATE_LIMITED", "PROVIDER_HTTP_ERROR", "PROVIDER_INVALID_RESPONSE",
  "PROVIDER_MISSING_CONTENT", "PROVIDER_REQUEST_TOO_LARGE", "PROVIDER_RESPONSE_TOO_LARGE",
  "INPUT_BUDGET_EXCEEDED", "OPTIONS_INVALID", "RUN_SCOPE_MISMATCH", "EVIDENCE_CONTEXT_INVALID",
  "PACKET_CLAIM_UNRESOLVED", "PACKET_KNOWLEDGE_UNRESOLVED", "INPUT_CLAIM_COVERAGE_MISMATCH",
  "PRIVATE_FIELD_PRESENT",
]);

/**
 * 生成解说的四段式进度：真实链路是一次 Provider 请求，拿不到细粒度进度，
 * 因此这里用固定节奏推进前三段，最后一段「校验输出」保持进行中，直到响应返回。
 */
const LOADING_STEPS = ["准备事实", "识别表现", "组织解读", "校验输出"] as const;
const LOADING_STEP_DELAYS_MS = [2400, 5000, 8000] as const;

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; data: InterpretationResponse }
  | { kind: "error"; message: string };

// Verified results live in the owner-scoped server cache; every opening rechecks identity and versions.

/**
 * In-flight requests keyed by rideId. Dedupes concurrent `load()` calls —
 * most importantly the double-invoke that React Strict Mode performs on the
 * mount effect in development (mount → cleanup → mount), where both calls
 * fire before either has resolved. Without this, each call would issue its
 * own `/api/ride-analysis` POST, doubling Provider cost and latency.
 */
const inFlight = new Map<string, Promise<InterpretationResponse>>();

/** 演示用：强制降级到 B0 的合成响应，供 `?ai=b0` 预览降级页面。 */
function demoB0Response(rideId: string): InterpretationResponse {
  return { rideId, source: "b0", output: null, fallbackCode: "DATA_NOT_ELIGIBLE" };
}

export function InterpretationView({
  rideId,
  title,
  dateLabel,
  demoFallback,
  previewOnly,
}: {
  rideId: string;
  title: string;
  dateLabel?: string;
  demoFallback?: string;
  previewOnly?: boolean;
}) {
  const isDemoB0 = demoFallback === "b0";
  // demoB0 为 true 时跳过网络请求，直接展示降级页；点「重新解读」会退出演示、走真实链路。
  const [demoB0, setDemoB0] = useState(isDemoB0);
  const [state, setState] = useState<LoadState>(() => {
    if (isDemoB0) return { kind: "ok", data: demoB0Response(rideId) };
    return { kind: "loading" };
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
    if (demoB0) {
      setState({ kind: "ok", data: demoB0Response(rideId) });
      return;
    }
    setState({ kind: "loading" });

    // Reuse an in-flight request for the same rideId instead of firing a
    // second POST. Covers React Strict Mode's double-mount effect and any
    // other concurrent callers (e.g. the retry button during a pending load).
    let pending = inFlight.get(rideId);
    if (!pending) {
      pending = (async () => {
        const checked = (value: unknown): InterpretationResponse => {
          if (!hasInterpretationIdentity(value, rideId)) throw new Error("ANALYSIS_RESPONSE_MISMATCH");
          return value as InterpretationResponse;
        };
        if (!force) {
          const query = new URLSearchParams({ rideId });
          const cached = await fetch(`/api/ride-analysis?${query}`, { cache: "no-store" });
          if (!cached.ok) throw new Error(cached.status === 400 ? "ANALYSIS_RECORD_UNAVAILABLE" : "ANALYSIS_CACHE_UNAVAILABLE");
          const value = await cached.json();
          if (value.rideId !== rideId || typeof value.cached !== "boolean") throw new Error("ANALYSIS_RESPONSE_MISMATCH");
          if (value.cached) return { ...checked(value.response), cached: true, generatedAt: value.generatedAt };
        }
        const response = await fetch("/api/ride-analysis", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rideId }), cache: "no-store",
        });
        if (!response.ok) throw new Error(response.status === 400 ? "ANALYSIS_RECORD_UNAVAILABLE" : "ANALYSIS_REQUEST_FAILED");
        return checked(await response.json());
      })();
      inFlight.set(rideId, pending);
    }

    try {
      const data = await pending;
      setState({ kind: "ok", data });
    } catch (cause) {
      setState({
        kind: "error",
        message: cause instanceof Error ? cause.message : "UNKNOWN_NETWORK_ERROR",
      });
    } finally {
      // Only clear if it's still our promise; a forced refresh may have
      // replaced it.
      if (inFlight.get(rideId) === pending) {
        inFlight.delete(rideId);
      }
    }
  }, [rideId, demoB0]);

  useEffect(() => {
    void load();
  }, [load]);

  // 「重新解读」：跳过会话缓存重新请求；若处在降级演示中，则先退出演示再走真实链路。
  const reanalyze = useCallback(() => {
    if (previewOnly) return;
    if (demoB0) {
      setDemoB0(false);
      return;
    }
    void load(true);
  }, [demoB0, load, previewOnly]);

  return (
    <div className="ride-detail-page ride-detail-preview-page">
      <div className="candidate-preview-content">
        <header className="candidate-preview-header">
          <p className="kicker">RIDE INSIGHT</p>
          <h1>{title || "AI 骑行解读"}</h1>
          <p>基于本次记录中的可靠证据生成的整体评价、重点维度解读、表现高光与下一步建议。{dateLabel ? `覆盖骑行日期 ${dateLabel}。` : ""}</p>
          {state.kind === "ok" && state.data.cached && <div className="ui-state-row"><StatusBadge tone="active">已有解读</StatusBadge><span className="ui-version">{state.data.generatedAt ? new Date(state.data.generatedAt).toLocaleString("zh-CN") : "已恢复"}</span></div>}
        </header>

        {state.kind === "loading" && <LoadingSteps />}

        {state.kind === "error" && (
          <section className="candidate-preview-rejected">
            <h2>解读暂时不可用</h2>
            <p>{state.message === "ANALYSIS_RECORD_UNAVAILABLE" ? "这条记录已不可用，请关闭解读后重新选择。" : "读取解读时出错，骑行记录已保留，可以重试。"}</p>
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
            <p>{interpretationFailureMessage(state.data.fallbackCode)}</p>
            {demoB0 && <p className="candidate-demo-hint">{previewOnly ? "状态演示：当前展示数据不足；未请求模型。" : "演示模式：本条为强制降级预览，点击「重新解读」可走真实链路。"}</p>}
            <FeedbackButtons feedback={feedback} onSubmit={submitFeedback} />
          </section>
        )}

        {state.kind === "ok" && state.data.source === "v2" && state.data.v2Candidate && (
          <V2Body candidate={state.data.v2Candidate} feedback={feedback} onFeedback={submitFeedback} />
        )}

        {state.kind !== "loading" && !previewOnly && (
          <div className="candidate-reanalyze">
            <button type="button" className="candidate-reanalyze-button" onClick={reanalyze}>
              <SparkIcon />
              重新解读
            </button>
            <p>重新调用 AI 解读链路，生成最新结果。</p>
          </div>
        )}

        {/* 2026-10-14 用户要求：链路说明与演示标注统一放「重新解读」按钮之后，
            不打断解读正文阅读流；仅 V2 结果显示。 */}
        {state.kind === "ok" && state.data.source === "v2" && state.data.v2Candidate && (
          <div className="candidate-engine-notes">
            <p className="candidate-demo-hint">V2 解读链路（证据体系重构版）·本次输出已通过全部校验后展示。</p>
            {state.data.v2Candidate.presentation.demoBypassNotice && (
              <p className="candidate-demo-hint">
                {state.data.v2Candidate.presentation.demoBypassNotice}——此输出未经过校验拦截，不代表正式产品质量。
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function V2Body({
  candidate,
  feedback,
  onFeedback,
}: {
  candidate: NonNullable<InterpretationResponse["v2Candidate"]>;
  feedback: "helpful" | "not_helpful" | null;
  onFeedback: (value: "helpful" | "not_helpful") => void;
}) {
  return (
    <>
      <RideOutputV2View presentation={candidate.presentation} charts={candidate.charts} />
      <FeedbackButtons feedback={feedback} onSubmit={onFeedback} />
    </>
  );
}

function LoadingSteps() {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const timers = LOADING_STEP_DELAYS_MS.map((delay, index) =>
      window.setTimeout(() => setActiveStep(index + 1), delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return (
    <div className="candidate-preview-notice candidate-loading-steps" role="status" aria-live="polite">
      <p className="candidate-loading-title">正在生成解读</p>
      <ol className="candidate-loading-list">
        {LOADING_STEPS.map((label, index) => {
          const status = index < activeStep ? "done" : index === activeStep ? "active" : "pending";
          return (
            <li className={`candidate-loading-step is-${status}`} key={label}>
              <span className="candidate-loading-mark" aria-hidden="true">{status === "done" && <CheckIcon />}</span>
              <span className="candidate-loading-text">{status === "active" ? `正在${label}…` : label}</span>
            </li>
          );
        })}
      </ol>
    </div>
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
