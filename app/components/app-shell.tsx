import type { ReactNode } from "react";

import { BottomNav } from "./bottom-nav";
import type { NavKey } from "./route-loading";

export { Brand } from "./brand";

export function AppShell({ children, active = "today" }: { children: ReactNode; active?: NavKey }) {
  return (
    <div className="app-viewport">
      <main className="page-content">{children}</main>
      <BottomNav active={active} />
    </div>
  );
}
