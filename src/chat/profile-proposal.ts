import { createUserProfile, type ProfileInput } from "../domain/user-profile.ts";

export const PROFILE_LABELS = { age: "年龄（岁）", heightCm: "身高（cm）", weightKg: "体重（kg）", maxHeartRateBpm: "最大心率（bpm）", ftpWatts: "FTP（W）" } as const;

/** Conservative prototype parser: explicit field names and units only, never infers missing units. */
export function proposeProfile(text: string): { input?: ProfileInput; clarification?: string } | null {
  if (/目标/.test(text)) return null;
  if (/(是什么|什么意思|怎么|多少|解释|为什么|[?？])/.test(text)) return null;
  const patterns = {
    age: /(?:年龄|我(?:今年)?)(?:改为|改成|是|为|[:：])?\s*(\d+)\s*岁/gi,
    heightCm: /身高(?:改为|改成|是|为|[:：])?\s*(\d+(?:\.\d+)?)\s*(?:cm|厘米)/gi,
    weightKg: /体重(?:改为|改成|是|为|[:：])?\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)/gi,
    maxHeartRateBpm: /最大心率(?:改为|改成|是|为|[:：])?\s*(\d+)\s*(?:bpm|次)/gi,
    ftpWatts: /FTP(?:改为|改成|是|为|[:：])?\s*(\d+)\s*(?:W|瓦)/gi,
  };
  if (!/(年龄|身高|体重|最大心率|FTP|我(?:今年)?\s*\d+\s*岁)/i.test(text)) return null;
  const input: ProfileInput = {};
  for (const [key, pattern] of Object.entries(patterns)) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 1) return { clarification: "同一字段出现了多个数值，请告诉我你要保存哪一个。" };
    if (matches[0]) input[key as keyof ProfileInput] = Number(matches[0][1]);
  }
  if (!Object.keys(input).length) return { clarification: "若要补充资料，请说明字段和单位，例如“体重 70 kg”。不知道的项目可以留空；也可以到「我的」填写。" };
  // A partially parsed statement must not silently drop an ambiguous field.
  for (const [label, key] of [["年龄", "age"], ["身高", "heightCm"], ["体重", "weightKg"], ["最大心率", "maxHeartRateBpm"], ["FTP", "ftpWatts"]] as const) {
    if (new RegExp(label, "i").test(text) && input[key] === undefined) return { clarification: `请确认${label}的数值和单位；不知道时可以暂不填写。` };
  }
  try { createUserProfile(input); } catch { return { clarification: "数值超出可保存范围，请核对后重新填写，或到「我的」修改。" }; }
  return { input };
}
