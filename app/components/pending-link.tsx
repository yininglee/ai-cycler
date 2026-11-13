"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";
import { RouteProgress } from "./route-loading";

export function LinkProgress({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return pending ? <RouteProgress label={label} inline /> : null;
}

export function PendingLink({ children, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props}>{children}<LinkProgress label="正在打开骑行详情" /></Link>;
}
