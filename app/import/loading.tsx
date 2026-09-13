import { AppShell } from "../components/app-shell";
import { RouteLoadingBody } from "../components/route-loading";

// 骑行（导入页）：路由级加载态。
export default function ImportLoading() {
  return <AppShell active="rides"><RouteLoadingBody active="rides" /></AppShell>;
}
