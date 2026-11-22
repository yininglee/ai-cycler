import { createHash } from "node:crypto";
import type { RideRecord } from "../domain/ride-schema.ts";
import type { UserProfile } from "../domain/user-profile.ts";

export type CachedRideInterpretation = { fingerprint: string; generatedAt: string; response: Record<string, unknown> };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function rideInterpretationFingerprint(ride: RideRecord, profile: UserProfile | null, policy: unknown): string {
  const health = profile ? { age: profile.age, heightCm: profile.heightCm, weightKg: profile.weightKg, maxHeartRate: profile.maxHeartRate, ftp: profile.ftp } : null;
  return createHash("sha256").update(JSON.stringify({ version: "ride-interpretation-cache-v1", ride, health, policy })).digest("hex");
}
export function canCacheRideInterpretation(response: Record<string, unknown>): boolean {
  return response.source === "v2" && record(response.v2Candidate) && response.v2Candidate.demoValidationBypass !== true;
}
export function readCachedRideInterpretation(result: unknown, fingerprint: string, rideId: string): CachedRideInterpretation | undefined {
  if (!record(result) || !record(result.successfulCache)) return undefined;
  const cache = result.successfulCache;
  if (cache.fingerprint !== fingerprint || typeof cache.generatedAt !== "string" || !Number.isFinite(Date.parse(cache.generatedAt))
    || !record(cache.response) || cache.response.rideId !== rideId || !canCacheRideInterpretation(cache.response)) return undefined;
  return { fingerprint, generatedAt: cache.generatedAt, response: cache.response };
}
