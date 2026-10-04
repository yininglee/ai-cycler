import type { EvidenceCapabilityKey, AnalysisDimensionId } from "./ride-analysis-evidence-v2.ts";
import type {
  Metric, MetricKey, RideActivity, RideIssue, RideRecord, RideSeries, RideSeriesMetadata,
  RideSeriesKey, RideSeriesPoint, RideSource, SensorKind, SensorQuality,
} from "./ride-schema.ts";
import type { RideTimingSummary, RideStopSegment, RideCruiseSegment } from "./ride-timing.ts";
import type { RideElevationSummary, RideElevationPoint, RideElevationCalibration } from "./ride-elevation.ts";
import type { RideRouteShapeSummary, RideRouteShapePoint, RideRouteShapeSegment } from "./ride-route-shape.ts";
import type { RideEventClimbSummary, RideEventClimb } from "./ride-event-climbs.ts";
import type { ZoneDistribution, ZoneBin, HeartRateZoneDistribution } from "./ride-zones.ts";
import type { RidePowerSummary, PowerZoneBin, PowerPeak } from "./ride-power.ts";

type Disposition = "fact" | "quality" | "inventory" | "private";
type ClaimTarget = "metric" | "feature" | "advanced" | "relation" | "limitation" | "none";
interface CoverageRoute {
  feature: string;
  capabilities: EvidenceCapabilityKey[];
  claim: ClaimTarget;
  packets: AnalysisDimensionId[];
  disposition: Disposition;
  reason?: string;
}

// Targets only: neither this catalog nor its route names build Claims or change the V1 API.
export const coverageRoutes = {
  identity: { feature: "ride identity and scenario", capabilities: [], claim: "none", packets: [], disposition: "inventory", reason: "Ride identity, sport and start time scope sources and historical comparability; no performance claim." },
  source: { feature: "source/version and device comparability", capabilities: [], claim: "none", packets: [], disposition: "inventory", reason: "Retain in authorized source inventory, not as performance evidence." },
  private: { feature: "excluded before projection", capabilities: [], claim: "none", packets: [], disposition: "private", reason: "File name or untrusted free text must not enter model input." },
  privacyGate: { feature: "relative-route privacy contract", capabilities: [], claim: "none", packets: [], disposition: "inventory", reason: "Validate privacy flags and version; do not pass raw route or policy metadata as a riding fact." },
  eventId: { feature: "stable event identity for source references", capabilities: [], claim: "none", packets: [], disposition: "inventory", reason: "An event identifier links atomic Claims, but cannot independently support a performance conclusion." },
  displayLabel: { feature: "deterministic display label", capabilities: [], claim: "none", packets: [], disposition: "inventory", reason: "Zone label formats its keyed boundary; it is not separate riding evidence." },
  metricMeta: { feature: "metric provenance, unit, evidence ID, quality and formula gate", capabilities: [], claim: "none", packets: [], disposition: "inventory", reason: "Attached to each accepted metric Claim/source or a limitation; not independent performance facts." },
  quality: { feature: "sensor coverage, counts, parse severity and availability", capabilities: ["sensorContinuity"], claim: "limitation", packets: ["pacingExecution", "climbPerformance", "heartRateLoad", "powerOutput", "intensityAndTrainingLoad", "cadenceStrategy", "crossSensorCoordination"], disposition: "quality" },
  timeBasis: { feature: "time-axis and interval eligibility", capabilities: ["timing", "sensorContinuity"], claim: "limitation", packets: ["pacingExecution", "climbPerformance", "heartRateLoad", "powerOutput", "intensityAndTrainingLoad", "cadenceStrategy", "crossSensorCoordination"], disposition: "quality" },
  seriesMeta: { feature: "series availability, provenance, coverage and continuity", capabilities: ["sensorContinuity"], claim: "limitation", packets: ["pacingExecution", "climbPerformance", "heartRateLoad", "powerOutput", "intensityAndTrainingLoad", "cadenceStrategy", "crossSensorCoordination"], disposition: "quality" },
  alignment: { feature: "ordered time/distance windows and gaps", capabilities: ["timing", "distance", "crossSensorAlignment"], claim: "feature", packets: ["pacingExecution", "climbPerformance", "heartRateLoad", "powerOutput", "intensityAndTrainingLoad", "cadenceStrategy", "crossSensorCoordination"], disposition: "fact" },
  distance: { feature: "distance and progress", capabilities: ["distance"], claim: "metric", packets: ["pacingExecution", "climbPerformance", "historicalPerformance"], disposition: "fact" },
  duration: { feature: "elapsed and moving duration, with distinct recorded/rule versions", capabilities: ["timing", "trainingLoad"], claim: "metric", packets: ["pacingExecution", "intensityAndTrainingLoad", "historicalPerformance"], disposition: "fact" },
  elevation: { feature: "gain/loss and terrain context", capabilities: ["elevation", "terrain"], claim: "metric", packets: ["climbPerformance", "pacingExecution", "historicalPerformance"], disposition: "fact" },
  speed: { feature: "level/peak and quality-gated pacing", capabilities: ["speed"], claim: "metric", packets: ["pacingExecution", "historicalPerformance"], disposition: "fact" },
  heartRate: { feature: "heart-rate level/peak, not zone baseline", capabilities: ["heartRate"], claim: "metric", packets: ["heartRateLoad", "historicalPerformance"], disposition: "fact" },
  power: { feature: "power level/peak, provenance preserved", capabilities: ["power"], claim: "metric", packets: ["powerOutput", "intensityAndTrainingLoad", "historicalPerformance"], disposition: "fact" },
  np: { feature: "recorded NP distinct from calculated NP", capabilities: ["normalizedPower"], claim: "metric", packets: ["powerOutput", "intensityAndTrainingLoad", "historicalPerformance"], disposition: "fact" },
  cadence: { feature: "cadence level/peak", capabilities: ["cadence"], claim: "metric", packets: ["cadenceStrategy", "historicalPerformance"], disposition: "fact" },
  energy: { feature: "activity energy only, not TSS or recovery", capabilities: [], claim: "metric", packets: ["intensityAndTrainingLoad"], disposition: "fact" },
  route: { feature: "relative route signature, never raw coordinates", capabilities: ["route", "sameRouteComparison"], claim: "feature", packets: ["pacingExecution", "climbPerformance", "historicalPerformance"], disposition: "fact" },
  seriesElevation: { feature: "distance-based smoothed elevation and terrain events", capabilities: ["elevation", "terrain", "climbing"], claim: "feature", packets: ["climbPerformance", "pacingExecution"], disposition: "fact" },
  seriesSpeed: { feature: "weighted speed, moving stages, stops and cruise", capabilities: ["speed", "speedStability", "stops", "cruise"], claim: "feature", packets: ["pacingExecution", "climbPerformance", "crossSensorCoordination"], disposition: "fact" },
  seriesHeartRate: { feature: "weighted HR, zones, stages and aligned response", capabilities: ["heartRate", "heartRateZones", "heartRateDrift", "crossSensorAlignment"], claim: "feature", packets: ["heartRateLoad", "climbPerformance", "crossSensorCoordination"], disposition: "fact" },
  seriesPower: { feature: "continuous-window power, NP, zones, peaks and aligned response", capabilities: ["power", "powerStability", "powerPeaks", "normalizedPower", "crossSensorAlignment"], claim: "feature", packets: ["powerOutput", "intensityAndTrainingLoad", "climbPerformance", "crossSensorCoordination"], disposition: "fact" },
  seriesCadence: { feature: "weighted cadence, zones, stages and aligned response", capabilities: ["cadence", "cadenceZones", "crossSensorAlignment"], claim: "feature", packets: ["cadenceStrategy", "crossSensorCoordination"], disposition: "fact" },
  alignedPair: { feature: "same-window sensor pairing with overlap, lag and gap metadata", capabilities: ["crossSensorAlignment", "sensorContinuity"], claim: "relation", packets: ["crossSensorCoordination", "climbPerformance"], disposition: "fact", reason: "Derived only from two qualified, overlapping series; no common window means no relation Claim." },
  rule: { feature: "version and source identity for deterministic result", capabilities: [], claim: "none", packets: [], disposition: "inventory", reason: "Reference on each resulting Claim/source; never an independent riding conclusion." },
  timing: { feature: "deterministic elapsed/moving/stopped time and mean speeds", capabilities: ["timing", "stops", "speed"], claim: "advanced", packets: ["pacingExecution", "intensityAndTrainingLoad", "historicalPerformance"], disposition: "fact" },
  stop: { feature: "all stop boundaries, durations and types", capabilities: ["stops"], claim: "advanced", packets: ["pacingExecution"], disposition: "fact" },
  cruise: { feature: "all cruise boundaries, duration, distance and stability", capabilities: ["cruise", "speedStability"], claim: "advanced", packets: ["pacingExecution", "climbPerformance"], disposition: "fact" },
  elevationResult: { feature: "smoothed gain/loss/min/max/range with separate device and rule values", capabilities: ["elevation", "terrain"], claim: "advanced", packets: ["climbPerformance", "pacingExecution", "historicalPerformance"], disposition: "fact" },
  elevationInternal: { feature: "smoothing, anomaly isolation and source calibration", capabilities: ["elevation", "terrain"], claim: "limitation", packets: ["climbPerformance", "pacingExecution"], disposition: "quality", reason: "Raw/smoothed point arrays stay out of model input; retain derived facts, source discrepancies and limitations." },
  terrain: { feature: "local/trend terrain distance, moving/classified coverage", capabilities: ["terrain", "climbing"], claim: "advanced", packets: ["climbPerformance", "pacingExecution", "crossSensorCoordination"], disposition: "fact" },
  terrainInternal: { feature: "grade-window and segment-boundary features", capabilities: ["terrain", "climbing"], claim: "feature", packets: ["climbPerformance", "pacingExecution", "crossSensorCoordination"], disposition: "fact", reason: "No raw grade arrays in model input; keep all eligible segment features and window/version differences." },
  terrainQuality: { feature: "route availability and classified-distance coverage", capabilities: ["terrain"], claim: "limitation", packets: ["climbPerformance", "pacingExecution"], disposition: "quality" },
  climb: { feature: "every eligible climb: category, boundaries, distance, grade, gain, difficulty and sensor values", capabilities: ["climbing"], claim: "advanced", packets: ["climbPerformance", "heartRateLoad", "powerOutput", "crossSensorCoordination"], disposition: "fact" },
  climbQuality: { feature: "climb availability, power quality and per-field missing reasons", capabilities: ["climbing", "power"], claim: "limitation", packets: ["climbPerformance", "powerOutput", "crossSensorCoordination"], disposition: "quality" },
  zones: { feature: "time-weighted bin key, duration and share", capabilities: ["heartRateZones", "cadenceZones"], claim: "advanced", packets: ["heartRateLoad", "cadenceStrategy"], disposition: "fact" },
  zoneQuality: { feature: "sensor/baseline, time coverage, missing/stopped time and unavailability", capabilities: ["heartRateZones", "cadenceZones"], claim: "limitation", packets: ["heartRateLoad", "cadenceStrategy"], disposition: "quality" },
  baseline: { feature: "max-HR baseline value and user/estimated source", capabilities: ["maxHeartRateBaseline", "heartRateZones"], claim: "advanced", packets: ["heartRateLoad"], disposition: "fact" },
  powerLevel: { feature: "quality-gated average and maximum power", capabilities: ["power"], claim: "advanced", packets: ["powerOutput", "historicalPerformance"], disposition: "fact" },
  powerNp: { feature: "continuous-window normalized power", capabilities: ["power", "normalizedPower"], claim: "advanced", packets: ["powerOutput", "intensityAndTrainingLoad", "historicalPerformance"], disposition: "fact" },
  powerIntensity: { feature: "IF needs valid NP and user-confirmed FTP", capabilities: ["normalizedPower", "verifiedFtp", "intensity"], claim: "advanced", packets: ["intensityAndTrainingLoad"], disposition: "fact" },
  powerLoad: { feature: "TSS needs valid NP, confirmed FTP, IF and eligible duration", capabilities: ["normalizedPower", "verifiedFtp", "intensity", "timing", "trainingLoad"], claim: "advanced", packets: ["intensityAndTrainingLoad", "historicalPerformance"], disposition: "fact" },
  confirmedFtp: { feature: "user-confirmed, versioned FTP source", capabilities: ["verifiedFtp"], claim: "advanced", packets: ["intensityAndTrainingLoad"], disposition: "fact", reason: "Never replace a missing confirmed FTP with an estimated one." },
  powerWeight: { feature: "power divided by versioned Profile body mass", capabilities: ["power", "userProfile"], claim: "advanced", packets: ["powerOutput"], disposition: "fact" },
  powerQuality: { feature: "coverage, gaps, interpolation, riding time and unavailable reasons", capabilities: ["power", "normalizedPower", "powerPeaks"], claim: "limitation", packets: ["powerOutput", "intensityAndTrainingLoad"], disposition: "quality" },
  powerZones: { feature: "FTP-dependent time-weighted power zone", capabilities: ["verifiedFtp", "powerZones"], claim: "advanced", packets: ["powerOutput", "intensityAndTrainingLoad"], disposition: "fact" },
  peak: { feature: "per-contiguous-segment 10/20/30s peak and time window", capabilities: ["powerPeaks"], claim: "advanced", packets: ["powerOutput", "intensityAndTrainingLoad"], disposition: "fact" },
} as const satisfies Record<string, CoverageRoute>;

type CoverageRouteKey = keyof typeof coverageRoutes;

// Each concrete source/interface property is listed once. Compiler errors expose newly added fields.
export const fieldCoverage = {
  record: { activity: "identity", series: "seriesMeta" } satisfies Record<keyof RideRecord, CoverageRouteKey>,
  activity: {
    schemaVersion: "source", rideId: "identity", sport: "identity", source: "source", startTime: "identity",
    metrics: "metricMeta", sensorQuality: "quality", sourceIssues: "quality",
  } satisfies Record<keyof RideActivity, CoverageRouteKey>,
  source: {
    kind: "source", fileName: "private", parserVersion: "source", formatVersion: "source",
    deviceManufacturer: "source", deviceProduct: "source",
  } satisfies Record<keyof RideSource, CoverageRouteKey>,
  metrics: {
    distanceM: "distance", elapsedTimeS: "duration", movingTimeS: "duration", elevationGainM: "elevation", elevationLossM: "elevation",
    avgSpeedMps: "speed", maxSpeedMps: "speed", avgHeartRateBpm: "heartRate", maxHeartRateBpm: "heartRate",
    avgPowerW: "power", maxPowerW: "power", normalizedPowerW: "np", avgCadenceRpm: "cadence", maxCadenceRpm: "cadence",
    activityEnergyKcal: "energy",
  } satisfies Record<MetricKey, CoverageRouteKey>,
  metric: {
    value: "metricMeta", unit: "metricMeta", provenance: "metricMeta", confidence: "metricMeta", evidenceId: "metricMeta",
    sourceField: "metricMeta", sourceUnit: "metricMeta", qualityStatus: "metricMeta", recordedAt: "metricMeta", formulaVersion: "metricMeta",
  } satisfies Record<keyof Metric, CoverageRouteKey>,
  sensorQuality: { coverage: "quality", sampleCount: "quality", invalidSampleCount: "quality" } satisfies Record<keyof SensorQuality, CoverageRouteKey>,
  sensorKinds: { gps: "quality", heart_rate: "quality", power: "quality", cadence: "quality" } satisfies Record<SensorKind, CoverageRouteKey>,
  sourceIssue: { code: "quality", severity: "quality", message: "private", field: "quality" } satisfies Record<keyof RideIssue, CoverageRouteKey>,
  series: {
    schemaVersion: "source", rideId: "identity", source: "source", coordinateSpace: "privacyGate", privacy: "privacyGate",
    availableSeries: "seriesMeta", seriesMetadata: "seriesMeta", timeBasis: "timeBasis", points: "alignment",
  } satisfies Record<keyof RideSeries, CoverageRouteKey>,
  seriesSource: { kind: "source", parserVersion: "source" } satisfies Record<keyof RideSeries["source"], CoverageRouteKey>,
  seriesPrivacy: { ruleVersion: "privacyGate", preciseCoordinatesExcluded: "privacyGate" } satisfies Record<keyof RideSeries["privacy"], CoverageRouteKey>,
  seriesMetadata: {
    sourceField: "seriesMeta", unit: "seriesMeta", qualityStatus: "seriesMeta", sampleCount: "seriesMeta",
  } satisfies Record<keyof RideSeriesMetadata, CoverageRouteKey>,
  seriesKinds: {
    route: "route", distance: "alignment", elevation: "seriesElevation", speed: "seriesSpeed",
    heart_rate: "seriesHeartRate", power: "seriesPower", cadence: "seriesCadence",
  } satisfies Record<RideSeriesKey, CoverageRouteKey>,
  timeBasis: { kind: "timeBasis", startTime: "timeBasis" } satisfies Record<keyof Extract<RideSeries["timeBasis"], { kind: "elapsed_from_start" }>, CoverageRouteKey>,
  point: {
    sequence: "alignment", elapsedTimeS: "alignment", distanceM: "alignment", route: "route", elevationM: "seriesElevation",
    speedMps: "seriesSpeed", heartRateBpm: "seriesHeartRate", powerW: "seriesPower", cadenceRpm: "seriesCadence",
  } satisfies Record<keyof RideSeriesPoint, CoverageRouteKey>,
  derived: { jointSensorWindow: "alignedPair" } satisfies Record<"jointSensorWindow", CoverageRouteKey>,
  relativeRoute: { x: "route", y: "route" } satisfies Record<keyof NonNullable<RideSeriesPoint["route"]>, CoverageRouteKey>,
  timing: {
    rulesVersion: "rule", source: "rule", elapsedTimeS: "timing", movingTimeS: "timing", stoppedTimeS: "timing",
    elapsedAverageSpeedMps: "timing", movingAverageSpeedMps: "timing", stops: "stop", cruiseSegments: "cruise",
  } satisfies Record<keyof RideTimingSummary, CoverageRouteKey>,
  stop: {
    startElapsedTimeS: "stop", endElapsedTimeS: "stop", durationS: "stop", kind: "stop",
  } satisfies Record<keyof RideStopSegment, CoverageRouteKey>,
  cruise: {
    startElapsedTimeS: "cruise", endElapsedTimeS: "cruise", startDistanceM: "cruise", endDistanceM: "cruise",
    durationS: "cruise", distanceM: "cruise", averageSpeedMps: "cruise", speedCoefficientOfVariation: "cruise", isLong: "cruise",
  } satisfies Record<keyof RideCruiseSegment, CoverageRouteKey>,
  elevationSummary: {
    rulesVersion: "rule", gainM: "elevationResult", lossM: "elevationResult", minM: "elevationResult",
    maxM: "elevationResult", rangeM: "elevationResult", gainSource: "elevationInternal", lossSource: "elevationInternal",
    smoothedSegments: "elevationInternal", smoothedPoints: "elevationInternal", gainCalibration: "elevationInternal", lossCalibration: "elevationInternal",
  } satisfies Record<keyof RideElevationSummary, CoverageRouteKey>,
  elevationPoint: {
    distanceM: "elevationInternal", elevationM: "elevationInternal", elapsedTimeS: "elevationInternal", speedMps: "elevationInternal",
  } satisfies Record<keyof RideElevationPoint, CoverageRouteKey>,
  elevationCalibration: {
    deviceValueM: "elevationInternal", calculatedValueM: "elevationInternal", differenceM: "elevationInternal", needsReview: "elevationInternal",
  } satisfies Record<keyof RideElevationCalibration, CoverageRouteKey>,
  routeShape: {
    rulesVersion: "rule", isAvailable: "terrainQuality", gradeSegments: "terrainInternal", displayGradeSegments: "terrainInternal",
    trendSegments: "terrainInternal", segments: "terrainInternal", movingDistanceM: "terrain", classifiedDistanceM: "terrain",
    climbDistanceM: "terrain", flatDistanceM: "terrain", descentDistanceM: "terrain", trendClimbDistanceM: "terrain",
    trendFlatDistanceM: "terrain", trendDescentDistanceM: "terrain", trendClassifiedDistanceM: "terrain",
    coverageRatio: "terrainQuality", needsCoverageNotice: "terrainQuality",
  } satisfies Record<keyof RideRouteShapeSummary, CoverageRouteKey>,
  gradePoint: { distanceM: "terrainInternal", grade: "terrainInternal" } satisfies Record<keyof RideRouteShapePoint, CoverageRouteKey>,
  terrainSegment: {
    type: "terrainInternal", startDistanceM: "terrainInternal", endDistanceM: "terrainInternal", distanceM: "terrainInternal",
  } satisfies Record<keyof RideRouteShapeSegment, CoverageRouteKey>,
  climbSummary: {
    rulesVersion: "rule", isAvailable: "climbQuality", climbs: "climb", unavailableReasons: "climbQuality",
  } satisfies Record<keyof RideEventClimbSummary, CoverageRouteKey>,
  climb: {
    id: "eventId", rulesVersion: "rule", elevationRulesVersion: "rule", routeShapeRulesVersion: "rule", category: "climb",
    startDistanceM: "climb", endDistanceM: "climb", distanceM: "climb", netElevationGainM: "climb", averageGrade: "climb",
    difficultyScore: "climb", elapsedTimeS: "climb", movingAverageSpeedMps: "climb", averageHeartRateBpm: "climb",
    averagePowerW: "climb", powerQuality: "climbQuality", unavailableReasons: "climbQuality",
  } satisfies Record<keyof RideEventClimb, CoverageRouteKey>,
  zone: {
    rulesVersion: "rule", sensor: "zoneQuality", ridingDurationS: "zoneQuality", validDurationS: "zoneQuality",
    missingDurationS: "zoneQuality", stoppedDurationS: "zoneQuality", coverage: "zoneQuality", bins: "zones",
    unavailableReason: "zoneQuality",
  } satisfies Record<keyof ZoneDistribution, CoverageRouteKey>,
  heartRateZone: { baseline: "baseline" } satisfies Record<Exclude<keyof HeartRateZoneDistribution, keyof ZoneDistribution>, CoverageRouteKey>,
  heartRateBaseline: { maxHeartRateBpm: "baseline", source: "baseline" } satisfies Record<keyof NonNullable<HeartRateZoneDistribution["baseline"]>, CoverageRouteKey>,
  zoneBin: { key: "zones", label: "displayLabel", durationS: "zones", share: "zones" } satisfies Record<keyof ZoneBin, CoverageRouteKey>,
  powerSummary: {
    rulesVersion: "rule", qualityLevel: "powerQuality", unavailableReasons: "powerQuality", ridingDurationS: "powerQuality",
    validDurationS: "powerQuality", interpolatedDurationS: "powerQuality", coverage: "powerQuality", longestGapS: "powerQuality",
    gapCount: "powerQuality", averagePowerW: "powerLevel", maxPowerW: "powerLevel", normalizedPowerW: "powerNp",
    intensityFactor: "powerIntensity", trainingStressScore: "powerLoad", ftpW: "confirmedFtp", averagePowerToWeight: "powerWeight",
    normalizedPowerToWeight: "powerWeight", zones: "powerZones", peakPowers: "peak",
  } satisfies Record<keyof RidePowerSummary, CoverageRouteKey>,
  powerZoneBin: { key: "powerZones", label: "displayLabel", durationS: "powerZones", share: "powerZones" } satisfies Record<keyof PowerZoneBin, CoverageRouteKey>,
  peak: {
    durationS: "peak", averagePowerW: "peak", startElapsedTimeS: "peak", endElapsedTimeS: "peak", rulesVersion: "rule", powerToWeight: "peak",
  } satisfies Record<keyof PowerPeak, CoverageRouteKey>,
} as const;
