import Link from "next/link";

export default function NotFound() {
  return <main className="standalone-state"><span>404</span><h1>没有找到这条记录</h1><p>它可能不在当前本地样例中，或已经被移除。</p><Link className="primary-button" href="/import">返回选择记录</Link></main>;
}
