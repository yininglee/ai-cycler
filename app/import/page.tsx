import Link from "next/link";

import { AppShell, Brand } from "../components/app-shell";
import { ArrowIcon, CheckIcon } from "../components/icons";
import { RideFileUpload } from "../components/ride-file-upload";

const samples = [
  { id: "l1-built-in-sample", capability: "轨迹", title: "只有轨迹", note: "距离、时间、速度、爬升" },
  { id: "l2-built-in-sample", capability: "心率", title: "包含心率", note: "在基础数据上增加心率" },
  { id: "l3-built-in-sample", capability: "功率", title: "包含功率", note: "在心率上增加可靠功率" },
] as const;

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = (await searchParams).state ?? "empty";

  return (
    <AppShell active="rides">
      <header className="topbar"><Brand /><span className="step-pill">1 / 3</span></header>
      <section className="page-intro">
        <p className="kicker">选择记录</p>
        <h1>从一条真实骑行开始。</h1>
        <p className="lead">导入一条 FIT 或 GPX，先查看可靠的骑行事实，再按需获取 AI 解读。</p>
      </section>

      {state === "loading" && <div className="state-card" aria-live="polite"><span className="spinner" /><h2>正在读取记录</h2><p>基础事实会优先出现，不需要等待 AI。</p></div>}
      {state === "error" && <div className="state-card error-state" role="alert"><span>!</span><h2>文件暂时无法读取</h2><p>请确认文件完整，且格式为 FIT 或 GPX。你的文件没有上传给模型。</p><Link className="secondary-button" href="/import">重新选择</Link></div>}
      {state !== "loading" && state !== "error" && (
        <>
          <RideFileUpload />

          <section className="section-block">
            <div className="section-heading"><div><p className="kicker">立即体验</p><h2>选择示例记录</h2></div></div>
            <div className="sample-list">
              {samples.map((sample) => <Link key={sample.id} className="sample-card" href={`/rides/${sample.id}`}><span className="level-badge">{sample.capability}</span><div><h3>{sample.title}</h3><p>{sample.note}</p></div><ArrowIcon /></Link>)}
            </div>
          </section>

          <details className="state-preview"><summary>预览异常与降级状态</summary><div className="state-links"><Link href="/rides/gpx-no-timestamps"><CheckIcon />GPX 无时间戳</Link><Link href="/rides/fit-truncated-file">! FIT 文件损坏</Link><Link href="/import?state=loading">加载状态</Link><Link href="/import?state=error">错误状态</Link></div></details>
        </>
      )}
    </AppShell>
  );
}
