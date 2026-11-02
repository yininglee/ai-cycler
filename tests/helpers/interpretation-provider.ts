import assert from "node:assert/strict";
import type { RideModelInputV2 } from "../../src/domain/ride-model-input-v2.ts";
import { RIDE_OUTPUT_SCHEMA_VERSION } from "../../src/ai/ride-output-schema-v2.ts";

/** Input-bound provider response for integration tests, not a model quality evaluation. */
export function interpretationProviderReply(prompt: string) {
  const marker = "【版本化输入 JSON】\n";
  const input: RideModelInputV2 = prompt.includes(marker) ? JSON.parse(prompt.split(marker)[1]) : JSON.parse(prompt.split("【原始输入 JSON】\n")[1].split("\n")[0]);
  const questions = input.questions.filter(q => q.eligibility === "available");
  assert.ok(questions.length);
  const anchor = input.claims.find(c => c.confidence === "high" && c.kind !== "limitation")!;
  return { schemaVersion: RIDE_OUTPUT_SCHEMA_VERSION,
    label: { text: "本次骑行数据完整，表现处于预期范围。", conclusionType: "fact", claimIds: [anchor.claimId] },
    overallAssessment: { text: questions.length < 2 ? "本次骑行可用数据有限，整体表现为一次普通的训练记录。" : "本次骑行整体表现为一次普通的训练记录。", conclusionType: "fact", claimIds: [anchor.claimId] },
    dimensions: questions.map(q => ({ dimensionId: q.dimensionId, assertions: [{ text: q.qualityStatus === "soft" ? "该维度数据部分依赖估算，表现处于预期范围。" : "该维度表现处于预期范围。", conclusionType: "fact", claimIds: [q.claimIds.map(id => input.claims.find(c => c.claimId === id)).find(c => c && c.kind !== "limitation")!.claimId] }] })),
    limitations: [...new Set(input.questions.flatMap(q => q.limitations))],
  };
}
