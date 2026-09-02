export const RIDE_SCHEMA_VERSION = "0.2" as const;
export const RIDE_SERIES_SCHEMA_VERSION = "0.1" as const;

export type DataSourceKind = "sample" | "fit" | "gpx";
export type DataLevel = "L1" | "L2" | "L3";
export type AnalysisMode = "full" | "basic" | "rejected";
export type MetricProvenance = "recorded" | "calculated" | "estimated";
export type Confidence = "high" | "medium" | "low";
export type QualityStatus = "valid" | "degraded";
export type SensorKind = "gps" | "heart_rate" | "power" | "cadence";

export type MetricUnit =
  | "m"
  | "s"
  | "m/s"
  | "bpm"
  | "W"
  | "rpm"
  | "kcal";

export type MetricKey =
  | "distanceM"
  | "elapsedTimeS"
  | "movingTimeS"
  | "elevationGainM"
  | "elevationLossM"
  | "avgSpeedMps"
  | "maxSpeedMps"
  | "avgHeartRateBpm"
  | "maxHeartRateBpm"
  | "avgPowerW"
  | "maxPowerW"
  | "normalizedPowerW"
  | "avgCadenceRpm"
  | "maxCadenceRpm"
  | "activityEnergyKcal";

export interface Metric {
  value: number;
  unit: MetricUnit;
  provenance: MetricProvenance;
  confidence: Confidence;
  evidenceId: string;
  sourceField: string;
  sourceUnit: string;
  qualityStatus: QualityStatus;
  recordedAt?: string;
  formulaVersion?: string;
}

export type RideMetrics = Partial<Record<MetricKey, Metric>>;

export interface RideSource {
  kind: DataSourceKind;
  fileName?: string;
  parserVersion: string;
  formatVersion?: string;
  deviceManufacturer?: string;
  deviceProduct?: string;
}

export interface SensorQuality {
  coverage: number;
  sampleCount: number;
  invalidSampleCount: number;
}

export interface RideIssue {
  code: string;
  severity: "warning" | "error";
  message: string;
  field?: string;
}

export interface RideActivity {
  schemaVersion: typeof RIDE_SCHEMA_VERSION;
  rideId: string;
  sport: "cycling" | "indoor_cycling";
  source: RideSource;
  startTime?: string;
  metrics: RideMetrics;
  sensorQuality: Partial<Record<SensorKind, SensorQuality>>;
  sourceIssues: RideIssue[];
}

export type RideSeriesKey =
  | "route"
  | "distance"
  | "elevation"
  | "speed"
  | "heart_rate"
  | "power"
  | "cadence";

export interface RelativeRoutePoint {
  x: number;
  y: number;
}

export interface RideSeriesPoint {
  sequence: number;
  elapsedTimeS?: number;
  distanceM?: number;
  route?: RelativeRoutePoint;
  elevationM?: number;
  speedMps?: number;
  heartRateBpm?: number;
  powerW?: number;
  cadenceRpm?: number;
}

export interface RideSeriesMetadata {
  sourceField: string;
  unit: string;
  qualityStatus: QualityStatus;
  sampleCount: number;
}

export interface RideSeries {
  schemaVersion: typeof RIDE_SERIES_SCHEMA_VERSION;
  rideId: string;
  source: Pick<RideSource, "kind" | "parserVersion">;
  coordinateSpace: "relative_normalized";
  privacy: {
    ruleVersion: "relative-route-v0.1";
    preciseCoordinatesExcluded: true;
  };
  availableSeries: RideSeriesKey[];
  seriesMetadata: Partial<Record<RideSeriesKey, RideSeriesMetadata>>;
  timeBasis: { kind: "elapsed_from_start"; startTime: string } | { kind: "none" };
  points: RideSeriesPoint[];
}

export interface RideRecord {
  activity: RideActivity;
  series: RideSeries;
}

export interface RideValidationResult {
  valid: boolean;
  issues: RideIssue[];
}

export interface RideCapabilityProfile {
  rideId: string;
  dataLevel: DataLevel;
  analysisMode: AnalysisMode;
  availableMetrics: MetricKey[];
  allowedTopics: string[];
  forbiddenTopics: string[];
  limitations: string[];
}

export interface RideFixture {
  fixtureId: string;
  description: string;
  activity: RideActivity;
  series: RideSeries;
  expected: {
    valid: boolean;
    dataLevel: DataLevel;
    analysisMode: AnalysisMode;
    requiredIssueCodes: string[];
  };
}
