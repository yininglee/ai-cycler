import type { UserProfile } from "../../src/domain/user-profile";
let reading: Promise<UserProfile> | null = null;
// Share the first request so parallel cards establish one development session.
export function readProfile(): Promise<UserProfile> {
  if (!reading) reading = fetch("/api/profile", { cache: "no-store" }).then(async response => {
    if (!response.ok) throw new Error("资料暂时无法读取，请重试");
    return response.json() as Promise<UserProfile>;
  }).finally(() => { reading = null; });
  return reading;
}

export async function saveUx(body: unknown): Promise<UserProfile> {
  const response = await fetch("/api/ux", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("保存失败，请重试；输入已保留。");
  return response.json();
}
