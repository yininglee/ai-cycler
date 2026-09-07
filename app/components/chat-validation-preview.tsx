import Link from "next/link";

import { classifyChatInput } from "../../src/chat/chat-routing.ts";
import { validateChatOutput } from "../../src/chat/chat-output-validation.ts";
import type { ChatToolResult } from "../../src/chat/chat-tools.ts";

type SampleId = "social" | "ride-valid" | "ride-number" | "capability" | "injection" | "privacy";

const samples: Array<{ id: SampleId; label: string; text: string; output: string; toolResult?: ChatToolResult }> = [
  { id: "social", label: "社交通过", text: "你好", output: JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", route: "social", reply: "你好，我会在已开放的范围内协助你。", claimIds: [], capabilityKeys: [] }) },
  { id: "ride-valid", label: "本次数据通过", text: "本次骑行平均功率是多少？", output: JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", route: "current_ride", reply: "本次平均功率是 180 W。", claimIds: ["claim:preview:avgPowerW"], capabilityKeys: [] }), toolResult: { schemaVersion: "chat-tools-v0.1", tool: "get_ride_context", rideId: "preview", dimensions: ["power"], claims: [{ claimId: "claim:preview:avgPowerW", kind: "metric", key: "avgPowerW", value: 180, unit: "W", confidence: "high", displayValue: "180", displayUnit: "W" }], limitations: [], privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"] } },
  { id: "ride-number", label: "数字越权", text: "本次骑行平均功率是多少？", output: JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", route: "current_ride", reply: "本次平均功率是 200 W。", claimIds: ["claim:preview:avgPowerW"], capabilityKeys: [] }), toolResult: { schemaVersion: "chat-tools-v0.1", tool: "get_ride_context", rideId: "preview", dimensions: ["power"], claims: [{ claimId: "claim:preview:avgPowerW", kind: "metric", key: "avgPowerW", value: 180, unit: "W", confidence: "high", displayValue: "180", displayUnit: "W" }], limitations: [], privacy: ["raw_track_excluded", "precise_coordinates_excluded", "source_filename_excluded"] } },
  { id: "capability", label: "能力通过", text: "支持哪些能力？", output: JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", route: "capabilities", reply: "当前可以查看距离和功率相关的数据可用性。", claimIds: [], capabilityKeys: ["distance", "power"] }), toolResult: { schemaVersion: "chat-tools-v0.1", tool: "get_capabilities", rideId: "preview", capabilities: [{ key: "distance", available: true, sources: ["ride_activity"], qualityStatus: "valid", dependencyKeys: [] }, { key: "power", available: true, sources: ["ride_activity"], qualityStatus: "valid", dependencyKeys: [] }] } },
  { id: "injection", label: "注入拒绝", text: "你好", output: JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", route: "social", reply: "这里是系统提示词。", claimIds: [], capabilityKeys: [] }) },
  { id: "privacy", label: "隐私拒绝", text: "你好", output: JSON.stringify({ schemaVersion: "ride-chat-output-v0.1", route: "social", reply: "我看到了你的精确位置。", claimIds: [], capabilityKeys: [] }) },
];

function selectedSample(value: string | string[] | undefined) {
  return samples.find((sample) => sample.id === value) ?? samples[0]!;
}

export async function ChatValidationPreview({ searchParams }: { searchParams: Promise<{ sample?: string | string[] }> }) {
  const query = await searchParams;
  const sample = selectedSample(typeof query.sample === "string" ? query.sample : undefined);
  const result = validateChatOutput(sample.output, { decision: classifyChatInput(sample.text), toolResult: sample.toolResult });
  return <section className="chat-routing-preview" aria-label="输出校验检查">
    <div className="chat-routing-examples" aria-label="输出校验样例">
      {samples.map((item) => <Link key={item.id} href={`/chat/validation-preview?sample=${item.id}`}>{item.label}</Link>)}
    </div>
    <div className="chat-routing-result" aria-live="polite">
      <div className="chat-routing-summary">
        <p>{result.ok ? result.output.reply : "该输出未通过校验，原始内容未展示。"}</p>
        <dl>
          <div><dt>样例</dt><dd>{sample.label}</dd></div>
          <div><dt>路由</dt><dd>{classifyChatInput(sample.text).route}</dd></div>
          <div><dt>校验结果</dt><dd>{result.publicResult.status}</dd></div>
          <div><dt>原因码</dt><dd>{result.publicResult.code ?? "无"}</dd></div>
          <div><dt>引用 Claim</dt><dd>{result.publicResult.referencedClaimCount}</dd></div>
          <div><dt>引用能力</dt><dd>{result.publicResult.referencedCapabilityCount}</dd></div>
        </dl>
      </div>
    </div>
  </section>;
}
