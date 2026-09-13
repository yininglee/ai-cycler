import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { RouteTransitionOverlay } from "./components/route-transition";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 骑行伙伴 Demo",
  description: "把骑行记录变成清晰、可信、可追溯的解读。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f4f2",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        {/* 常驻在根布局：点击链接后立即铺上的加载层，跨路由不被卸载重建。 */}
        <RouteTransitionOverlay />
      </body>
    </html>
  );
}
