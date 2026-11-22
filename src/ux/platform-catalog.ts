export const PLATFORMS = [
  { id: "garmin", name: "佳明", label: "GARMIN", mark: "G" },
  { id: "xingzhe", name: "行者", label: "行者", mark: "行" },
  { id: "onelap", name: "顽鹿", label: "顽鹿运动", mark: "鹿" },
  { id: "igpsport", name: "IGPSPORT", label: "iGPSPORT", mark: "iG" },
] as const;
export type PlatformId = typeof PLATFORMS[number]["id"];
export type ImportPlatformId = "onelap" | "xingzhe";
export function isImportPlatform(value: unknown): value is ImportPlatformId {
  return value === "onelap" || value === "xingzhe";
}
export function isPlatformId(value: unknown): value is PlatformId {
  return PLATFORMS.some(platform => platform.id === value);
}
export function platformInfo(id: PlatformId) {
  return PLATFORMS.find(platform => platform.id === id)!;
}
