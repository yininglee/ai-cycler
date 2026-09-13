import { AppShell } from "../components/app-shell";
import { RouteLoadingBody } from "../components/route-loading";

// 伙伴（聊天页）：路由级加载态。该页要读会话与骑行记录，首次进入最慢。
export default function ChatLoading() {
  return <AppShell active="partner"><RouteLoadingBody active="partner" /></AppShell>;
}
