import type { ReactNode } from "react";

import { BottomNav } from "./bottom-nav";
import type { NavKey } from "./route-loading";

export { Brand } from "./brand";

// showNav=false 用于骑行详情页：该页有自己的固定返回按钮 + tab 切换器，
// 不需要底部导航，且底部会留出多余空白。
export function AppShell({
  children,
  active = "partner",
  showNav = true,
  pageClassName = "",
}: {
  children: ReactNode;
  active?: NavKey;
  showNav?: boolean;
  pageClassName?: string;
}) {
  return (
    <div className={showNav ? "app-viewport" : "app-viewport app-viewport-no-nav"}>
      <main className={`page-content ${pageClassName}`}>{children}</main>
      {showNav && <BottomNav active={active} />}
    </div>
  );
}
