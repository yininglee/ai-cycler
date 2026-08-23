import { buildAtomicCapabilityProfile } from "../src/domain/atomic-capabilities.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import { createUserProfile, type UserProfile } from "../src/domain/user-profile.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

interface Scenario {
  label: string;
  fixtureId: string;
  profile?: UserProfile;
}

const timestamp = "2026-08-20T08:00:00.000Z";
const scenarios: Scenario[] = [
  { label: "基础记录 / 无资料", fixtureId: "l1-built-in-sample" },
  { label: "基础记录 / 年龄+身体资料", fixtureId: "l1-built-in-sample", profile: createUserProfile({ age: 35, heightCm: 175, weightKg: 70 }, timestamp) },
  { label: "心率记录 / 年龄", fixtureId: "l2-built-in-sample", profile: createUserProfile({ age: 35 }, timestamp) },
  { label: "心率+功率记录 / 年龄+FTP", fixtureId: "l3-built-in-sample", profile: createUserProfile({ age: 35, ftpWatts: 240 }, timestamp) },
  { label: "无时间戳GPX / 年龄+FTP", fixtureId: "gpx-no-timestamps", profile: createUserProfile({ age: 35, ftpWatts: 240 }, timestamp) },
];

const keys = [
  ["route", "骑行轨迹"],
  ["distance", "距离"],
  ["timing", "时间"],
  ["speed", "速度"],
  ["elevation", "海拔/爬升"],
  ["heartRate", "心率"],
  ["maxHeartRateBaseline", "最大心率基线"],
  ["heartRateZones", "心率区间"],
  ["power", "功率"],
  ["normalizedPower", "标准化功率（NP）"],
  ["verifiedFtp", "可信FTP"],
  ["powerZones", "功率区间"],
  ["trainingLoad", "训练负荷"],
  ["cadence", "踏频（cadence）"],
  ["userProfile", "个人资料"],
  ["historyComparison", "历史比较"],
  ["sameRouteComparison", "同路线比较"],
  ["trend", "趋势"],
] as const;

function recordFor(fixtureId: string): RideRecord {
  const fixture = getRideFixture(fixtureId);
  return { activity: fixture.activity, series: fixture.series };
}

const profiles = scenarios.map((scenario) => ({
  scenario,
  capabilityProfile: buildAtomicCapabilityProfile(recordFor(scenario.fixtureId), scenario.profile),
}));

console.log(`AtomicCapabilityProfile ${profiles[0]!.capabilityProfile.schemaVersion} / ${profiles[0]!.capabilityProfile.rulesVersion}`);
console.log(`| 能力 | ${scenarios.map((item) => item.label).join(" | ")} |`);
console.log(`|---|${scenarios.map(() => "---").join("|")}|`);
for (const [key, label] of keys) {
  const values = profiles.map(({ capabilityProfile }) => {
    const capability = capabilityProfile.capabilities.find((item) => item.key === key)!;
    return capability.available ? `可用（${capability.qualityStatus}）` : `不可用（${capability.unavailableReason}）`;
  });
  console.log(`| ${label} \`${key}\` | ${values.join(" | ")} |`);
}
