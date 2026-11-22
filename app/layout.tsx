import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { getNextSession } from "../src/auth/next-session";
import { AccountScopeProvider } from "./components/account-scope";

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

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await getNextSession();
  return (
    <html lang="zh-CN">
      <body><AccountScopeProvider scope={session?.accountEmail ? session.userId : undefined}>{children}</AccountScopeProvider></body>
    </html>
  );
}
