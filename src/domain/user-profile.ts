/**
 * UserProfile v0.1
 *
 * This is a small, storage-independent fact contract.  Values are kept with
 * their provenance so a later PostgreSQL adapter can replace localStorage
 * without changing the meaning of the data sent to the analysis layer.
 */
export const USER_PROFILE_SCHEMA_VERSION = "0.1" as const;
export const MAX_HEART_RATE_FORMULA_VERSION = "max-heart-rate-220-age-v1" as const;

export type UserProvidedSource = "user_provided";
export type MaxHeartRateSource = UserProvidedSource | "system_estimated";

export interface ProfileFact<T> {
  value: T;
  source: UserProvidedSource;
  createdAt: string;
  updatedAt: string;
}

export interface MaxHeartRateFact {
  valueBpm: number;
  source: MaxHeartRateSource;
  createdAt: string;
  updatedAt: string;
  formulaVersion?: typeof MAX_HEART_RATE_FORMULA_VERSION;
}

export interface FtpFact {
  valueWatts: number;
  source: UserProvidedSource;
  trustStatus: "user_confirmed";
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  ux?: { mode?: "demo" | "blank"; blankSince?: string; skipped?: boolean; goal?: { title: string; detail: string; updatedAt: string } | null };
  schemaVersion: typeof USER_PROFILE_SCHEMA_VERSION;
  age?: ProfileFact<number>;
  heightCm?: ProfileFact<number>;
  weightKg?: ProfileFact<number>;
  maxHeartRate?: MaxHeartRateFact;
  ftp?: FtpFact;
  updatedAt: string;
}

export interface ProfileInput {
  age?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  maxHeartRateBpm?: number | null;
  ftpWatts?: number | null;
}

export const profileRanges = {
  age: { min: 10, max: 120 },
  heightCm: { min: 100, max: 250 },
  weightKg: { min: 25, max: 300 },
  maxHeartRateBpm: { min: 80, max: 240 },
  ftpWatts: { min: 50, max: 1_500 },
} as const;

export type ProfileField = keyof ProfileInput;

export class ProfileValidationError extends Error {
  readonly field: ProfileField;

  constructor(field: ProfileField, message: string) {
    super(message);
    this.name = "ProfileValidationError";
    this.field = field;
  }
}

function assertFinite(value: number, field: ProfileField): void {
  if (!Number.isFinite(value)) throw new ProfileValidationError(field, "请输入有效数字");
}

function assertRange(value: number, field: ProfileField): void {
  assertFinite(value, field);
  const range = profileRanges[field];
  if (value < range.min || value > range.max) {
    throw new ProfileValidationError(field, `请输入 ${range.min}–${range.max} 范围内的数值`);
  }
}

function assertInteger(value: number, field: ProfileField): void {
  assertRange(value, field);
  if (!Number.isInteger(value)) throw new ProfileValidationError(field, "请输入整数");
}

function isoNow(now?: string | Date): string {
  const value = now instanceof Date ? now.toISOString() : now ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(value))) throw new Error("时间必须是 ISO-8601 字符串");
  return new Date(value).toISOString();
}

function fact<T>(value: T, now: string): ProfileFact<T> {
  return { value, source: "user_provided", createdAt: now, updatedAt: now };
}

export function estimateMaxHeartRate(age: number): number {
  assertInteger(age, "age");
  return 220 - age;
}

function estimatedHeartRate(age: number, now: string): MaxHeartRateFact {
  return {
    valueBpm: estimateMaxHeartRate(age),
    source: "system_estimated",
    createdAt: now,
    updatedAt: now,
    formulaVersion: MAX_HEART_RATE_FORMULA_VERSION,
  };
}

export function emptyUserProfile(now?: string | Date): UserProfile {
  const timestamp = isoNow(now);
  return { schemaVersion: USER_PROFILE_SCHEMA_VERSION, updatedAt: timestamp };
}

export function createUserProfile(input: ProfileInput = {}, now?: string | Date): UserProfile {
  const profile = emptyUserProfile(now);
  return updateUserProfile(profile, input, now);
}

/**
 * 演示基线（demo baseline）
 *
 * 让 demo 打开即呈现“已填写”的个人资料，不必每次演示前手填一遍。
 * 全部字段按用户主动填写记录（maxHeartRate 为 user_provided、ftp 为
 * user_confirmed），因此界面会显示“你已手动填写”，而不是“系统估算”。
 */
export const DEMO_PROFILE_BASELINE_INPUT: ProfileInput = {
  age: 28,
  heightCm: 175,
  weightKg: 72,
  maxHeartRateBpm: 192,
  ftpWatts: 220,
};

/**
 * 固定时间戳 = 2026-10-08 12:37 (UTC+8)。演示中“更新于”保持稳定，
 * 截图与页面可以逐次对齐；需要动态时间时传入 now 覆盖即可。
 */
export const DEMO_PROFILE_BASELINE_TIMESTAMP = "2026-10-08T04:37:10.707Z";

export function demoBaselineProfile(now?: string | Date): UserProfile {
  return createUserProfile(DEMO_PROFILE_BASELINE_INPUT, now ?? DEMO_PROFILE_BASELINE_TIMESTAMP);
}

/** 是否至少记录了一项事实。用于区分“从未填写”与“有资料”。 */
export function hasAnyProfileFact(profile: UserProfile | null | undefined): boolean {
  if (!profile) return false;
  return Boolean(profile.age || profile.heightCm || profile.weightKg || profile.maxHeartRate || profile.ftp);
}

export function updateUserProfile(profile: UserProfile, input: ProfileInput, now?: string | Date): UserProfile {
  const timestamp = isoNow(now);
  const next: UserProfile = structuredClone(profile);
  next.schemaVersion = USER_PROFILE_SCHEMA_VERSION;
  let changed = false;

  if (input.age !== undefined) {
    changed = true;
    if (input.age === null) {
      delete next.age;
    } else {
      assertInteger(input.age, "age");
      next.age = next.age && next.age.value === input.age
        ? { ...next.age, updatedAt: timestamp }
        : fact(input.age, timestamp);
    }
    // A user-entered maximum heart rate is authoritative and must not be
    // silently overwritten when age changes.
    if ((!next.maxHeartRate || next.maxHeartRate.source === "system_estimated") && next.age) {
      next.maxHeartRate = estimatedHeartRate(next.age.value, timestamp);
    }
    if (!next.age && next.maxHeartRate?.source === "system_estimated") delete next.maxHeartRate;
  }

  if (input.heightCm !== undefined) {
    changed = true;
    if (input.heightCm === null) delete next.heightCm;
    else {
      assertRange(input.heightCm, "heightCm");
      next.heightCm = next.heightCm && next.heightCm.value === input.heightCm
        ? { ...next.heightCm, updatedAt: timestamp }
        : fact(input.heightCm, timestamp);
    }
  }

  if (input.weightKg !== undefined) {
    changed = true;
    if (input.weightKg === null) delete next.weightKg;
    else {
      assertRange(input.weightKg, "weightKg");
      next.weightKg = next.weightKg && next.weightKg.value === input.weightKg
        ? { ...next.weightKg, updatedAt: timestamp }
        : fact(input.weightKg, timestamp);
    }
  }

  if (input.maxHeartRateBpm !== undefined) {
    changed = true;
    if (input.maxHeartRateBpm === null) {
      if (next.age) next.maxHeartRate = estimatedHeartRate(next.age.value, timestamp);
      else delete next.maxHeartRate;
    } else {
      assertInteger(input.maxHeartRateBpm, "maxHeartRateBpm");
      next.maxHeartRate = {
        valueBpm: input.maxHeartRateBpm,
        source: "user_provided",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    }
  }

  if (input.ftpWatts !== undefined) {
    changed = true;
    if (input.ftpWatts === null) delete next.ftp;
    else {
      assertInteger(input.ftpWatts, "ftpWatts");
      next.ftp = {
        valueWatts: input.ftpWatts,
        source: "user_provided",
        trustStatus: "user_confirmed",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    }
  }

  if (changed) next.updatedAt = timestamp;
  return next;
}

export function parseProfileInput(values: Record<ProfileField, string>): ProfileInput {
  const parse = (field: ProfileField): number | null | undefined => {
    const raw = values[field];
    if (raw === undefined) return undefined;
    if (raw.trim() === "") return null;
    const number = Number(raw);
    if (!Number.isFinite(number)) throw new ProfileValidationError(field, "请输入有效数字");
    return number;
  };
  return {
    age: parse("age"),
    heightCm: parse("heightCm"),
    weightKg: parse("weightKg"),
    maxHeartRateBpm: parse("maxHeartRateBpm"),
    ftpWatts: parse("ftpWatts"),
  };
}

export function serializeUserProfile(profile: UserProfile): string {
  return JSON.stringify(profile);
}

export function deserializeUserProfile(raw: string): UserProfile | null {
  try {
    const value = JSON.parse(raw) as UserProfile;
    if (!value || value.schemaVersion !== USER_PROFILE_SCHEMA_VERSION || typeof value.updatedAt !== "string") return null;
    if (value.age) assertInteger(value.age.value, "age");
    if (value.heightCm) assertRange(value.heightCm.value, "heightCm");
    if (value.weightKg) assertRange(value.weightKg.value, "weightKg");
    if (value.maxHeartRate) assertInteger(value.maxHeartRate.valueBpm, "maxHeartRateBpm");
    if (value.ftp) assertInteger(value.ftp.valueWatts, "ftpWatts");
    return value;
  } catch {
    return null;
  }
}
