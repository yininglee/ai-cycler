import { AppShell } from "../../components/app-shell";
import { RouteLoadingBody } from "../../components/route-loading";

// 骑行详情：路由级加载态。详情页要读记录、历史比较，且首次访问需编译。
// 详情页不显示底部导航，加载骨架保持一致。
export default function RideDetailLoading() {
  return <AppShell showNav={false}><RouteLoadingBody active="ride-detail" /></AppShell>;
}
