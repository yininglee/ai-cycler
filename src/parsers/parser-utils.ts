import type {
  Confidence,
  Metric,
  MetricProvenance,
  MetricUnit,
  SensorQuality,
} from "../domain/ride-schema.ts";
import { RideParseError } from "./parse-errors.ts";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface MetricSourceMetadata {
  sourceField: string;
  sourceUnit?: string;
  recordedAt?: string;
  qualityStatus?: Metric["qualityStatus"];
}

export function assertUploadSize(byteLength: number): void {
  if (byteLength === 0) {
    throw new RideParseError("FILE_EMPTY", "上传文件为空");
  }
  if (byteLength > MAX_UPLOAD_BYTES) {
    throw new RideParseError("FILE_TOO_LARGE", "上传文件超过 50 MB 限制");
  }
}

export function metric(
  value: number | undefined,
  unit: MetricUnit,
  evidenceId: string,
  provenance: MetricProvenance = "recorded",
  confidence: Confidence = "high",
  formulaVersion?: string,
  sourceMetadata?: MetricSourceMetadata,
): Metric | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return {
    value,
    unit,
    provenance,
    confidence,
    evidenceId,
    sourceField: sourceMetadata?.sourceField ?? evidenceId,
    sourceUnit: sourceMetadata?.sourceUnit ?? unit,
    qualityStatus: sourceMetadata?.qualityStatus ?? (confidence === "low" ? "degraded" : "valid"),
    ...(sourceMetadata?.recordedAt ? { recordedAt: sourceMetadata.recordedAt } : {}),
    ...(formulaVersion ? { formulaVersion } : {}),
  };
}

export function sensorQuality<T>(
  samples: T[],
  readValue: (sample: T) => unknown,
  isValid: (value: number) => boolean,
): SensorQuality | undefined {
  if (samples.length === 0) return undefined;

  let valid = 0;
  let invalid = 0;
  for (const sample of samples) {
    const raw = readValue(sample);
    if (raw === undefined || raw === null) continue;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && isValid(numeric)) valid += 1;
    else invalid += 1;
  }

  return {
    coverage: valid / samples.length,
    sampleCount: samples.length,
    invalidSampleCount: invalid,
  };
}

export function compactObject<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
