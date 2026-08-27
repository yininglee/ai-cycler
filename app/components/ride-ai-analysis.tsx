"use client";

import { useState } from "react";

type AiDimension = {
  key: string;
  text: string;
};

type AiOutput = {
  headline: string;
  overallAssessment: { text: string };
  dimensions: AiDimension[];
  limitations: string[];
  nextAction: { kind: "grounded" | "general"; text: string } | null;
  safetyLevel: "normal" | "caution" | "stop";
};

type AiResponse = {
  source: "b2" | "b0" | "safety_stop";
  output: AiOutput;
  fallbackCode?: string;
};

const DIMENSION_LABELS: Record<string, string> = {
  pace: "配速",
  heartRate: "心率",
  power: "功率",
  cadence: "踏频",
  climbing: "爬升",
  endurance: "耐力",
  history: "历史对比",
};

const FALLBACK_MESSAGES: Record<string, string> = {
  AI_TIMEOUT: "扣子响应超过 25 秒，已保留基础骑行摘要。",
  PROVIDER_ERROR: "扣子工作流请求失败，请检查服务是否已重启、PAT 是否有效以及工作流版本。",
  REPAIR_FAILED: "扣子返回内容未通过格式校验，已保留基础骑行摘要。",
  DATA_NOT_ELIGIBLE: "这条记录不满足 AI 解读条件，已保留基础骑行摘要。",
  AI_NOT_CONFIGURED: "AI 配置未完整加载，请重启 Demo 服务后重试。",
  AI_DISABLED: "AI 解读当前未开启。",
};

function dimensionLabel(key: string): string {
  return DIMENSION_LABELS[key] ?? "骑行表现";
}

export function RideAiAnalysis({ rideId }: { rideId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "fallback" | "error">("idle");
  const [response, setResponse] = useState<AiResponse | null>(null);

  async function loadAnalysis() {
    if (status === "loading") return;
    setStatus("loading");
    try {
      const result = await fetch("/api/ride-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rideId }),
      });
      if (!result.ok) throw new Error("AI_REQUEST_FAILED");
      const payload = await result.json() as AiResponse;
      setResponse(payload);
      setStatus(payload.source === "b2" || payload.source === "safety_stop" ? "success" : "fallback");
    } catch {
      setResponse(null);
      setStatus("error");
    }
  }

  if (status === "idle") {
    return (
      <section className="ride-ai-entry" aria-label="AI 骑行解读">
        <div>
          <p className="kicker">RIDE INSIGHT</p>
          <h2>想知道这次骑得怎么样？</h2>
          <p>基于本次记录中的可靠证据生成解读，点击后开始。</p>
        </div>
        <button className="ride-ai-button" type="button" onClick={loadAnalysis}>查看 AI 解读</button>
      </section>
    );
  }

  if (status === "loading") {
    return (
      <section className="ride-ai-panel" aria-live="polite">
        <div className="ride-ai-loading" aria-hidden="true" />
        <div><p className="kicker">RIDE INSIGHT</p><h2>正在整理这次骑行</h2><p>基础骑行数据已保留，AI 解读完成后会显示在这里。</p></div>
      </section>
    );
  }

  const aiDisabled = response?.fallbackCode === "AI_DISABLED" || response?.fallbackCode === "AI_NOT_CONFIGURED";

  if (status === "fallback" || status === "error" || !response) {
    const fallbackMessage = response?.fallbackCode
      ? FALLBACK_MESSAGES[response.fallbackCode] ?? "AI 解读暂时不可用，已保留基础骑行摘要。"
      : "AI 请求未完成，已保留基础骑行摘要。";
    return (
      <section className="ride-ai-panel ride-ai-fallback" aria-live="polite">
        <div><p className="kicker">RIDE INSIGHT</p><h2>{aiDisabled ? "AI 解读当前未开启" : "本次暂未生成 AI 解读"}</h2><p>{aiDisabled ? "当前仅展示基础骑行摘要，不会自动调用 AI。" : fallbackMessage}</p></div>
        {!aiDisabled && <button className="ride-ai-secondary-button" type="button" onClick={loadAnalysis}>重新尝试</button>}
      </section>
    );
  }

  const { output } = response;
  if (output.safetyLevel === "stop") {
    return <section className="ride-ai-panel ride-ai-stop" aria-live="polite"><p className="kicker">安全提示</p><h2>{output.headline}</h2><p>{output.overallAssessment.text}</p></section>;
  }

  return (
    <section className="ride-ai-panel" aria-live="polite">
      <header className="ride-ai-panel-heading"><div><p className="kicker">RIDE INSIGHT</p><h2>{output.headline}</h2></div><span>AI 解读</span></header>
      <p className="ride-ai-assessment">{output.overallAssessment.text}</p>
      {output.dimensions.length > 0 && <div className="ride-ai-dimensions">
        {output.dimensions.map((dimension) => <article key={dimension.key}><h3>{dimensionLabel(dimension.key)}</h3><p>{dimension.text}</p></article>)}
      </div>}
      {output.nextAction && <div className="ride-ai-action"><p>{output.nextAction.kind === "grounded" ? "基于本次数据的建议" : "通用建议"}</p><strong>{output.nextAction.text}</strong></div>}
      {output.limitations.length > 0 && <div className="ride-ai-limitations">{output.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}</div>}
    </section>
  );
}
