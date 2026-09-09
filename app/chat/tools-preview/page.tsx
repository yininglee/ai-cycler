import Link from "next/link";

import { Brand } from "../../components/app-shell";
import { getNextSessionUserId } from "../../../src/auth/next-session.ts";
import { CHAT_COMPARISON_WINDOW_DAYS, chatComparisonMetricKeys, executeChatTool, type ChatToolResult } from "../../../src/chat/chat-tools.ts";
import { getApplicationRepository } from "../../../src/persistence/application-repository.ts";

function ToolResult({ title, result }: { title: string; result: ChatToolResult }) {
  return <section className="chat-tool-result">
    <header>
      <div><p className="kicker">READ ONLY</p><h2>{title}</h2></div>
      <span>{Buffer.byteLength(JSON.stringify(result), "utf8")} B</span>
    </header>
    <pre>{JSON.stringify(result, null, 2)}</pre>
  </section>;
}

export default async function ChatToolsPreviewPage() {
  const userId = await getNextSessionUserId();
  const repository = getApplicationRepository();
  const latestRide = userId ? (await repository.listRides(userId))[0]?.record : undefined;
  let results: ChatToolResult[] = [];
  if (userId && latestRide) {
    results = await Promise.all([
      executeChatTool(repository, userId, {
        tool: "get_ride_context",
        input: { rideId: latestRide.activity.rideId, dims: ["summary", "heart_rate", "power", "cadence", "elevation"] },
      }),
      executeChatTool(repository, userId, {
        tool: "get_capabilities",
        input: { rideId: latestRide.activity.rideId, caps: ["route", "distance", "timing", "speed", "elevation", "heartRate", "power", "cadence"] },
      }),
      // CHAT-13：compare_rides——最新记录（锚点）与 30 天窗口历史基线的比较投影。
      executeChatTool(repository, userId, {
        tool: "compare_rides",
        input: { rideId: latestRide.activity.rideId, metrics: [...chatComparisonMetricKeys], windowDays: CHAT_COMPARISON_WINDOW_DAYS },
      }),
    ]);
  }

  return <main className="chat-tools-preview">
    <header className="topbar"><Brand /><Link className="step-pill" href="/chat">返回对话</Link></header>
    <section className="page-intro compact">
      <p className="kicker">LOCAL DEMO · CHAT-02 · CHAT-13</p>
      <h1>只读工具检查</h1>
      <p className="lead">只展示当前开发会话最新骑行的白名单投影。页面不调用模型，也不包含轨迹点、精确坐标、源文件名或完整用户资料。compare_rides 展示锚点与最近 {CHAT_COMPARISON_WINDOW_DAYS} 天历史基线的比较结果（含可比性与原因码）。</p>
    </section>
    {results.length === 0
      ? <p className="chat-tool-empty">当前会话没有可检查的骑行记录，请先从骑行页导入。</p>
      : <div className="chat-tool-grid">
          <ToolResult title="get_ride_context" result={results[0]} />
          <ToolResult title="get_capabilities" result={results[1]} />
          <ToolResult title="compare_rides" result={results[2]} />
        </div>}
  </main>;
}
