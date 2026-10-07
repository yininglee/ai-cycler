import Link from "next/link";

import { AppShell } from "../../components/app-shell";
import { BackIcon } from "../../components/icons";
import { RideOutputV2DegradedView, RideOutputV2View } from "../../components/ride-output-v2-view";
import { buildRideOutputPresentationV2 } from "../../../src/ai/ride-output-presentation-v2";
import { RIDE_OUTPUT_SCHEMA_VERSION } from "../../../src/ai/ride-output-schema-v2";
import type { RideModelOutputV2 } from "../../../src/ai/ride-output-schema-v2";
import { rideKnowledgeBaseV21 } from "../../../src/domain/ride-knowledge-base-v21";

/**
 * S6-04 developer demonstration page (OFFLINE · V2).
 *
 * Renders the V2 output contract against hand-built fixtures with ZERO model
 * or provider calls. NOT a production route — the production chain stays on
 * V1 until S6-03 wires the ride-analysis API behind the migration switch.
 * Scenario switcher covers the acceptance set: full output, omitted optional
 * sections, repaired output, and the two degraded fallbacks (b0 / safety_stop).
 */
const SCENARIOS = [
  { id: "normal", label: "完整输出" },
  { id: "omitted", label: "可选段省略" },
  { id: "repaired", label: "修复后输出" },
  { id: "b0", label: "B0 降级" },
  { id: "safety_stop", label: "安全停机" },
] as const;

type ScenarioId = (typeof SCENARIOS)[number]["id"];

const knowledgeTitles: Record<string, string> = Object.fromEntries(
  rideKnowledgeBaseV21.map((entry) => [entry.knowledgeId, entry.title]),
);

const fullOutput: RideModelOutputV2 = {
  schemaVersion: RIDE_OUTPUT_SCHEMA_VERSION,
  label: {
    text: "阈值强度下的稳定功率输出",
    conclusionType: "fact",
    claimIds: ["ride.power.mean"],
  },
  overallAssessment: {
    text: "本次骑行平均功率 220W、变异系数 4.1%，输出稳定；强度系数 0.88，属于阈值区间的一次耐力训练。",
    conclusionType: "fact",
    claimIds: ["ride.power.mean", "ride.power.cv", "ride.load.if"],
  },
  highlights: [
    {
      text: "第 38-45 分钟连续 8 分钟功率维持在 265-280W，为本次最长的阈值区段。",
      conclusionType: "fact",
      claimIds: ["ride.power.peak-window"],
    },
    {
      text: "后半程心率与功率同步上升，没有出现功率下降而心率上升的解耦迹象。",
      conclusionType: "fact",
      claimIds: ["ride.hr.power-coupling"],
    },
  ],
  dimensions: [
    {
      dimensionId: "powerOutput",
      assertions: [
        {
          text: "平均功率 220W，约为 FTP 的 92%；变异系数 4.1%，输出平稳。",
          conclusionType: "fact",
          claimIds: ["ride.power.mean", "ride.power.cv"],
        },
        {
          text: "按功率训练分级，Z4 阈值区间通常为 FTP 的 91%-105%，本次整体强度落在该区间。",
          conclusionType: "knowledgeReference",
          claimIds: [],
          knowledgeIds: ["kb-b1-power-zones"],
        },
      ],
    },
    {
      dimensionId: "heartRateLoad",
      assertions: [
        {
          text: "平均心率 158 次/分，占估算最大心率 188 次/分的 84%，有氧负荷较高。",
          conclusionType: "fact",
          claimIds: ["ride.hr.mean", "profile.hr.max"],
        },
      ],
    },
  ],
  suggestions: [
    {
      text: "阈值区段表现稳定，可以在下次训练中尝试把阈值区段从 8 分钟延长到 2 组 10 分钟。",
      conclusionType: "suggestion",
      claimIds: ["ride.power.peak-window"],
    },
    {
      text: "本次强度系数 0.88 已经较高，建议接下来 1-2 天安排低强度恢复骑行。",
      conclusionType: "suggestion",
      claimIds: ["ride.load.if"],
      riskNote: "如出现持续疲劳或晨脉升高，应进一步降低负荷。",
    },
  ],
  limitations: [
    "本次骑行海拔数据存在 12% 缺口，爬坡相关结论未生成。",
    "训练计划数据当前未接入，无法评价是否符合计划。",
  ],
};

const omittedOutput: RideModelOutputV2 = {
  schemaVersion: RIDE_OUTPUT_SCHEMA_VERSION,
  label: {
    text: "数据受限的一次骑行记录",
    conclusionType: "fact",
    claimIds: ["ride.power.mean"],
  },
  overallAssessment: {
    text: "本次骑行功率数据完整，平均功率 220W；其余传感器数据存在缺口，相关维度已省略。",
    conclusionType: "fact",
    claimIds: ["ride.power.mean"],
  },
  dimensions: [
    {
      dimensionId: "powerOutput",
      assertions: [
        {
          text: "平均功率 220W，变异系数 4.1%，输出平稳。",
          conclusionType: "fact",
          claimIds: ["ride.power.mean", "ride.power.cv"],
        },
      ],
    },
  ],
  limitations: [
    "心率与踏频数据覆盖率不足，对应维度解读未生成。",
    "海拔数据缺失，爬坡表现维度解读未生成。",
  ],
};

function buildScenarioPresentation(scenario: ScenarioId) {
  if (scenario === "omitted") {
    return buildRideOutputPresentationV2(omittedOutput, { knowledgeTitles });
  }
  return buildRideOutputPresentationV2(fullOutput, {
    knowledgeTitles,
    repairOutcomeLabel: scenario === "repaired" ? "本地整理后通过" : undefined,
  });
}

export default async function RideInterpretationPreviewV2Page({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string | string[] }>;
}) {
  const query = await searchParams;
  const raw = Array.isArray(query.scenario) ? query.scenario[0] : query.scenario;
  const scenario: ScenarioId = (SCENARIOS.find((item) => item.id === raw) ?? SCENARIOS[0]).id;

  return (
    <AppShell active="rides">
      <div className="ride-detail-page ride-detail-preview-page">
        <header className="detail-nav">
          <Link className="icon-button" href="/rides" aria-label="返回骑行列表"><BackIcon /></Link>
          <nav className="detail-tabs candidate-preview-tabs" aria-label="骑行记录详情" role="tablist">
            <Link href="/rides">骑行记录</Link>
            <Link className="active" href="/rides/interpretation-preview-v2" aria-current="page">AI 解读 V2 预览</Link>
          </nav>
          <span className="nav-spacer" aria-hidden="true" />
        </header>

        <div className="candidate-preview-content">
          <header className="candidate-preview-header">
            <p className="kicker">OFFLINE · V2</p>
            <h1>骑后 AI 解读 V2 预览</h1>
            <p>基于内置固定样例检查 V2 输出合同的界面展示：分段结构、知识引用角标与底部知识出处、可选段省略、修复留痕与降级兜底。不调用模型，不代表生产输出。</p>
          </header>

          <div className="candidate-preview-notice" role="status">
            <strong>离线 V2 预览</strong>
            <span>不调用模型、不接供应商；生产链路仍走 V1，待 S6-03 切换。</span>
            <code>{RIDE_OUTPUT_SCHEMA_VERSION}</code>
          </div>

          <nav className="v2-scenario-nav" aria-label="预览场景">
            {SCENARIOS.map((item) => (
              <Link
                className={item.id === scenario ? "active" : undefined}
                href={`/rides/interpretation-preview-v2?scenario=${item.id}`}
                key={item.id}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {scenario === "b0" ? (
            <RideOutputV2DegradedView mode="b0" fallbackCode="AI_VALIDATION_FAILED_B0" />
          ) : scenario === "safety_stop" ? (
            <RideOutputV2DegradedView mode="safety_stop" fallbackCode="SAFETY_STOP" />
          ) : (
            <RideOutputV2View presentation={buildScenarioPresentation(scenario)} />
          )}
        </div>
      </div>
    </AppShell>
  );
}
