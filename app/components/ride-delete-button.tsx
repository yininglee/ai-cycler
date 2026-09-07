"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RideDeleteButton({ rideId }: { rideId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!window.confirm("删除这条骑行记录及其 AI 解读？")) return;
    setBusy(true);
    const response = await fetch(`/api/rides/${encodeURIComponent(rideId)}`, { method: "DELETE" });
    if (response.ok) router.push("/import");
    else { setBusy(false); window.alert("删除失败，请稍后重试"); }
  }
  return <button className="clear-profile" type="button" onClick={remove} disabled={busy}>{busy ? "正在删除…" : "删除这条记录"}</button>;
}
