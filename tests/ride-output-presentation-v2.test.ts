// S6-04 targeted tests: presentation adapter from RideModelOutputV2 to the
// display sections consumed by ride-output-v2-view / interpretation-preview-v2.
// Knowledge references surface as numbered footnotes collected at the bottom
// of the page (user decision 2026-10-06: no on-screen conclusion-type labels).

import test from "node:test";
import assert from "node:assert/strict";

import { analysisDimensionIds } from "../src/domain/ride-analysis-evidence-v2.ts";
import {
  RIDE_V2_DIMENSION_TITLES,
  buildRideOutputPresentationV2,
} from "../src/ai/ride-output-presentation-v2.ts";
import { RIDE_OUTPUT_SCHEMA_VERSION } from "../src/ai/ride-output-schema-v2.ts";
import type { RideModelOutputV2 } from "../src/ai/ride-output-schema-v2.ts";

const baseOutput: RideModelOutputV2 = {
  schemaVersion: RIDE_OUTPUT_SCHEMA_VERSION,
  label: { text: "阈值强度下的稳定功率输出", conclusionType: "fact", claimIds: ["ride.power.mean"] },
  overallAssessment: {
    text: "平均功率 220W、变异系数 4.1%，输出稳定。",
    conclusionType: "fact",
    claimIds: ["ride.power.mean", "ride.power.cv"],
  },
  dimensions: [
    {
      dimensionId: "powerOutput",
      assertions: [
        {
          text: "平均功率 220W，输出平稳。",
          conclusionType: "fact",
          claimIds: ["ride.power.mean"],
        },
        {
          text: "按功率训练分级，Z4 阈值区间通常为 FTP 的 91%-105%。",
          conclusionType: "knowledgeReference",
          claimIds: [],
          knowledgeIds: ["kb-b1-power-zones"],
        },
      ],
    },
    {
      dimensionId: "longTermLoadRecovery",
      assertions: [
        {
          text: "按体能-疲劳模型，TSB 为正通常表示状态向好。",
          conclusionType: "knowledgeReference",
          claimIds: [],
          knowledgeIds: ["kb-b1-pmc"],
        },
        {
          text: "TSB +12.5，训练负荷平衡，整体恢复良好。",
          conclusionType: "fact",
          claimIds: ["history.pmc.tsb"],
        },
      ],
    },
  ],
  limitations: ["训练计划数据当前未接入。"],
};

const knowledgeTitles = {
  "kb-b1-power-zones": "Power Training Levels — Dr. Andrew Coggan",
  "kb-b1-pmc": "体能-疲劳模型（Fitness-Fatigue）",
};

test("full output maps every section and renders all dimensions uniformly", () => {
  const output: RideModelOutputV2 = {
    ...baseOutput,
    highlights: [{ text: "连续 8 分钟阈值区段。", conclusionType: "fact", claimIds: ["ride.power.peak-window"] }],
    suggestions: [{ text: "建议安排低强度恢复骑行。", conclusionType: "suggestion", claimIds: ["ride.load.if"] }],
  };
  const presentation = buildRideOutputPresentationV2(output, { knowledgeTitles });

  assert.equal(presentation.label.text, "阈值强度下的稳定功率输出");
  assert.equal(presentation.overallAssessment.text, "平均功率 220W、变异系数 4.1%，输出稳定。");
  assert.equal(presentation.highlights?.length, 1);
  assert.equal(presentation.suggestions?.length, 1);
  assert.deepEqual(presentation.limitations, ["训练计划数据当前未接入。"]);
  // S2-06 (user decision 2026-10-06): single-ride interpretation has no
  // history comparison or PMC section — both slots stay null and every
  // dimension carried by the output renders as a regular section.
  assert.equal(presentation.historyComparison, null);
  assert.equal(presentation.longTermLoadRecovery, null);
  assert.equal(presentation.dimensions.length, 2);
  assert.equal(presentation.dimensions[0].title, "功率输出");
  assert.equal(presentation.dimensions[1].title, "长期负荷与恢复");
  assert.equal(
    presentation.dimensions[1].assertions[1].text,
    "TSB +12.5，训练负荷平衡，整体恢复良好。",
  );
});

test("knowledge references become numbered footnotes collected at the bottom", () => {
  const presentation = buildRideOutputPresentationV2(baseOutput, { knowledgeTitles });
  const knowledgeAssertion = presentation.dimensions[0].assertions[1];
  assert.deepEqual(knowledgeAssertion.knowledgeFootnoteNumbers, [1]);
  const pmcKnowledgeAssertion = presentation.dimensions[1].assertions[0];
  assert.deepEqual(pmcKnowledgeAssertion?.knowledgeFootnoteNumbers, [2]);
  // Assertions without knowledge references carry no footnote markers.
  assert.deepEqual(presentation.dimensions[0].assertions[0].knowledgeFootnoteNumbers, []);
  assert.deepEqual(presentation.overallAssessment.knowledgeFootnoteNumbers, []);
  // The bottom footnote list resolves titles through the provided map.
  assert.deepEqual(
    presentation.knowledgeFootnotes.map((footnote) => ({ number: footnote.number, title: footnote.title })),
    [
      { number: 1, title: "Power Training Levels — Dr. Andrew Coggan" },
      { number: 2, title: "体能-疲劳模型（Fitness-Fatigue）" },
    ],
  );
});

test("repeated knowledge references reuse the same footnote number", () => {
  const output: RideModelOutputV2 = {
    ...baseOutput,
    dimensions: [
      baseOutput.dimensions[0],
      {
        dimensionId: "heartRateLoad",
        assertions: [
          {
            text: "按功率训练分级，阈值区间对应 FTP 的 91%-105%。",
            conclusionType: "knowledgeReference",
            claimIds: [],
            knowledgeIds: ["kb-b1-power-zones", "kb-b1-pmc"],
          },
        ],
      },
    ],
  };
  const presentation = buildRideOutputPresentationV2(output, { knowledgeTitles });
  const laterAssertion = presentation.dimensions[1].assertions[0];
  assert.deepEqual(laterAssertion.knowledgeFootnoteNumbers, [1, 2]);
  assert.equal(presentation.knowledgeFootnotes.length, 2);
});

test("omitted optional sections become null instead of fabricated content", () => {
  const presentation = buildRideOutputPresentationV2(baseOutput, { knowledgeTitles });
  assert.equal(presentation.highlights, null);
  assert.equal(presentation.historyComparison, null);
  assert.equal(presentation.suggestions, null);
  // S2-06: the PMC slot is a constant null; the PMC dimension carried by the
  // output still renders as a regular dimension section.
  assert.equal(presentation.longTermLoadRecovery, null);
  assert.equal(presentation.dimensions.length, 2);
});

test("repair outcome label passes through and defaults to null", () => {
  assert.equal(buildRideOutputPresentationV2(baseOutput).repairOutcomeLabel, null);
  assert.equal(
    buildRideOutputPresentationV2(baseOutput, { repairOutcomeLabel: "本地整理后通过" }).repairOutcomeLabel,
    "本地整理后通过",
  );
});

test("unknown dimension ids fall back to the raw id in the title", () => {
  const output: RideModelOutputV2 = {
    ...baseOutput,
    dimensions: [{ dimensionId: "futureDimension", assertions: baseOutput.dimensions[0].assertions }],
  };
  const presentation = buildRideOutputPresentationV2(output);
  assert.equal(presentation.dimensions[0].title, "futureDimension");
});

test("knowledge ids without a title entry fall back to the raw id", () => {
  const presentation = buildRideOutputPresentationV2(baseOutput, { knowledgeTitles: {} });
  assert.deepEqual(
    presentation.knowledgeFootnotes.map((footnote) => footnote.title),
    ["kb-b1-power-zones", "kb-b1-pmc"],
  );
});

test("footnote numbers follow page display order across sections", () => {
  const output: RideModelOutputV2 = {
    ...baseOutput,
    overallAssessment: {
      text: "整体稳定。",
      conclusionType: "fact",
      claimIds: ["ride.power.mean"],
    },
    highlights: [
      {
        text: "按体能-疲劳模型，近期状态向好。",
        conclusionType: "knowledgeReference",
        claimIds: [],
        knowledgeIds: ["kb-b1-pmc"],
      },
    ],
  };
  const presentation = buildRideOutputPresentationV2(output, { knowledgeTitles });
  // Highlights render before dimensions: kb-b1-pmc is numbered 1 there and
  // reused in the PMC dimension; kb-b1-power-zones inside a dimension is 2.
  assert.deepEqual(presentation.highlights?.[0].knowledgeFootnoteNumbers, [1]);
  assert.deepEqual(presentation.dimensions[0].assertions[1].knowledgeFootnoteNumbers, [2]);
  assert.deepEqual(presentation.dimensions[1].assertions[0].knowledgeFootnoteNumbers, [1]);
  assert.equal(presentation.knowledgeFootnotes[0].knowledgeId, "kb-b1-pmc");
  assert.equal(presentation.knowledgeFootnotes[1].knowledgeId, "kb-b1-power-zones");
});

test("dimension title catalog covers every analysis dimension", () => {
  for (const dimensionId of analysisDimensionIds) {
    assert.ok(RIDE_V2_DIMENSION_TITLES[dimensionId], `missing title for ${dimensionId}`);
  }
});
