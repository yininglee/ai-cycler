import {
  RIDE_EVIDENCE_RULES_VERSION,
  RIDE_EVIDENCE_SCHEMA_VERSION,
  evidenceCapabilityKeys,
  type EvidenceCapabilityKey,
  type EvidenceQuality,
  type EvidenceSource,
  type EvidenceSourceRef,
  type V2AnalysisClaim,
  type V2EvidenceCapability,
} from "./ride-analysis-evidence-v2.ts";
import type { RideRecord, RideSeriesKey } from "./ride-schema.ts";
import { buildRideTemporalFeaturesV2, type RideTemporalFeatureSnapshotV2, type TemporalSeriesFeatureV2 } from "./ride-temporal-features-v2.ts";
import { buildRideTemporalWindowsV2, type JointWindowV2, type RideTemporalWindowsV2, type SegmentWindowV2 } from "./ride-temporal-windows-v2.ts";
import { buildRideTimingSummary } from "./ride-timing.ts";
import { buildCadenceZoneDistribution, buildHeartRateZoneDistribution, type ZoneDistribution } from "./ride-zones.ts";
import {
  RIDE_DERIVED_METRICS_V21_VERSION,
  bestAveragePower,
  efficiencyFactor,
  negativeSplit,
  splitDifferencePercent,
  stoppedTimeSharePercent,
  variabilityIndex,
} from "./ride-derived-metrics-v21.ts";
import type { UserProfile } from "./user-profile.ts";

export const RIDE_CAPABILITY_CLAIMS_SCHEMA_VERSION = RIDE_EVIDENCE_SCHEMA_VERSION;
// S2-03 (PD-AI-16, user decision 2026-10-06): fixed 30-second joint-window
// relation claims are always delivered as one aggregate claim per sensor pair
// plus at most three deterministic representative windows. There is no
// per-window mode and no threshold.
// S2-05 (user decision 2026-10-06, option B): segment-level relation claims
// are removed entirely — cross-sensor pairing evidence is the fixed-window
// aggregate only.
export const RIDE_CAPABILITY_CLAIMS_RULES_VERSION = "ride-capability-claims-v2.6" as const;
export const RIDE_CONTIGUOUS_NP_RULES_VERSION = "ride-contiguous-np-v2.1" as const;
export const RIDE_POWER_ZONE_RULES_VERSION = "ride-power-zone-v2.2" as const;
export const RIDE_INTENSITY_RULES_VERSION = "ride-intensity-v2.1" as const;

const MAX_CONTINUOUS_INTERVAL_S = 10;
const MOVING_SPEED_MPS = 1 / 3.6;
const MIN_NP_COVERAGE = 0.8;
const VALID_POWER_COVERAGE = 0.9;

type Sensor = "speed" | "heart_rate" | "power" | "cadence";

export interface RideCapabilityClaimSnapshotV2 {
  schemaVersion: typeof RIDE_CAPABILITY_CLAIMS_SCHEMA_VERSION;
  rulesVersion: typeof RIDE_CAPABILITY_CLAIMS_RULES_VERSION;
  evidenceRulesVersion: typeof RIDE_EVIDENCE_RULES_VERSION;
  rideId: string;
  sourceInventory: EvidenceSource[];
  capabilities: V2EvidenceCapability[];
  claims: V2AnalysisClaim[];
  limitations: string[];
}

export interface BuildRideCapabilityClaimsV2Options {
  profile?: UserProfile | null;
  temporal?: RideTemporalFeatureSnapshotV2;
  windows?: RideTemporalWindowsV2;
}

export interface CapabilityClaimIssue {
  code: string;
  path: string;
}

interface SourceSpec {
  sourceId: string;
  kind: EvidenceSource["kind"];
  version: string;
  evidenceIds: Set<string>;
  status: EvidenceSource["status"];
  authorized: boolean;
  missingReason?: string;
}

interface PowerSecondData {
  segments: number[][];
  allValues: number[];
}

interface PowerZone {
  key: "z1" | "z2" | "z3" | "z4" | "z5" | "z6" | "z7";
  durationS: number;
  share: number;
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function compact(value: number, digits = 1): string {
  return Number(value.toFixed(digits)).toString();
}

// Reuses V1's metric-display-v0.1 rules (src/domain/ride-analysis-context.ts):
// claims carry a raw `value` plus a pre-converted human-facing display token so
// the model can copy the display verbatim instead of converting units itself
// (e.g. 6.68 m/s -> "24.05 km/h", 23997 s -> "6 小时 40 分钟"). Numbers the
// model copies from displayValue are whitelisted by the output validator.
function speedDisplayMps(value: number): { displayValue: string; displayUnit: string } {
  return { displayValue: compact(value * 3.6, 2), displayUnit: "km/h" };
}

function durationDisplayS(seconds: number): { displayValue: string; displayUnit: string } {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const text = hours === 0 ? `${minutes} 分钟` : minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
  return { displayValue: text, displayUnit: "duration" };
}

function overlap(start: number, end: number, otherStart: number, otherEnd: number): number {
  return Math.max(0, Math.min(end, otherEnd) - Math.max(start, otherStart));
}

function seriesEvidence(rideId: string, key: RideSeriesKey | Sensor): string {
  return `evidence:${rideId}:series:${key}`;
}

function derivedEvidence(rideId: string, key: string): string {
  return `evidence:${rideId}:v2:${key}`;
}

function sourceRef(source: SourceSpec, evidenceIds: string[]): EvidenceSourceRef {
  const ids = unique(evidenceIds);
  ids.forEach((id) => source.evidenceIds.add(id));
  return { sourceId: source.sourceId, version: source.version, evidenceIds: ids };
}

function source(
  rideId: string,
  suffix: string,
  kind: EvidenceSource["kind"],
  version: string,
  status: EvidenceSource["status"] = "available",
  missingReason?: string,
): SourceSpec {
  return {
    sourceId: `source:${rideId}:${suffix}`,
    kind,
    version,
    evidenceIds: new Set<string>(),
    status,
    authorized: true,
    ...(missingReason ? { missingReason } : {}),
  };
}

function inventoryItem(rideId: string, item: SourceSpec): EvidenceSource {
  return {
    sourceId: item.sourceId,
    kind: item.kind,
    version: item.version,
    status: item.status,
    authorized: item.authorized,
    evidenceIds: [...item.evidenceIds],
    ...(item.kind === "activity" || item.kind === "series" || item.kind === "summary" ? { rideId } : {}),
    ...(item.missingReason ? { missingReason: item.missingReason } : {}),
  };
}

function qualityFor(feature: TemporalSeriesFeatureV2): EvidenceQuality {
  if (!feature.statistics) return "unavailable";
  return feature.coverage >= VALID_POWER_COVERAGE && feature.unavailable.length === 0 ? "valid" : "soft";
}

function statusFor(quality: EvidenceQuality): V2EvidenceCapability["status"] {
  return quality === "valid" ? "available" : quality === "soft" ? "partial" : "unavailable";
}

function unavailableCapability(
  key: EvidenceCapabilityKey,
  dependencyKeys: readonly EvidenceCapabilityKey[],
  reason: string,
): V2EvidenceCapability {
  return {
    key,
    status: "unavailable",
    qualityStatus: "unavailable",
    dependencyKeys: [...dependencyKeys],
    sourceIds: [],
    evidenceIds: [],
    rulesVersion: RIDE_EVIDENCE_RULES_VERSION,
    supports: [],
    prohibits: [],
    unavailableReason: reason,
  };
}

function availableCapability(
  key: EvidenceCapabilityKey,
  dependencyKeys: readonly EvidenceCapabilityKey[],
  refs: EvidenceSourceRef[],
  qualityStatus: Exclude<EvidenceQuality, "unavailable">,
  supports: string[],
  prohibits: string[],
): V2EvidenceCapability {
  return {
    key,
    status: qualityStatus === "valid" ? "available" : "partial",
    qualityStatus,
    dependencyKeys: [...dependencyKeys],
    sourceIds: unique(refs.map((ref) => ref.sourceId)),
    evidenceIds: unique(refs.flatMap((ref) => ref.evidenceIds)),
    rulesVersion: RIDE_EVIDENCE_RULES_VERSION,
    supports,
    prohibits,
  };
}

function claim(
  rideId: string,
  key: string,
  value: number,
  unit: string,
  refs: EvidenceSourceRef[],
  options: {
    kind?: V2AnalysisClaim["kind"];
    provenance?: V2AnalysisClaim["provenance"];
    quality?: V2AnalysisClaim["qualityStatus"];
    formulaVersion?: string;
    supports?: string[];
    prohibits?: string[];
    displayValue?: string;
    displayUnit?: string;
    text?: string;
    aggregatedFromCount?: number;
  } = {},
): V2AnalysisClaim {
  const provenance = options.provenance ?? "calculated";
  return {
    claimId: `claim:${rideId}:v2:${key.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
    rideId,
    kind: options.kind ?? "feature",
    key,
    value,
    unit,
    ...(options.text ? { text: options.text } : {}),
    confidence: options.quality === "soft" ? "medium" : "high",
    provenance,
    qualityStatus: options.quality ?? "valid",
    sourceRefs: refs,
    evidenceIds: unique(refs.flatMap((ref) => ref.evidenceIds)),
    ...(provenance !== "recorded" ? { formulaVersion: options.formulaVersion ?? RIDE_CAPABILITY_CLAIMS_RULES_VERSION } : {}),
    ...(options.displayValue ? { displayValue: options.displayValue } : {}),
    ...(options.displayUnit ? { displayUnit: options.displayUnit } : {}),
    ...(options.aggregatedFromCount !== undefined ? { aggregatedFromCount: options.aggregatedFromCount } : {}),
    supports: options.supports ?? [],
    prohibits: options.prohibits ?? [],
  };
}

function featureByKey(snapshot: RideTemporalFeatureSnapshotV2, key: Sensor): TemporalSeriesFeatureV2 {
  const feature = snapshot.series.find((item) => item.seriesKey === key);
  if (!feature) throw new Error(`Temporal feature is missing: ${key}`);
  return feature;
}

function addSeriesClaims(
  claims: V2AnalysisClaim[],
  rideId: string,
  feature: TemporalSeriesFeatureV2,
  temporalSource: SourceSpec,
): void {
  if (!feature.statistics) return;
  const quality = qualityFor(feature) === "valid" ? "valid" : "soft";
  const refs = [sourceRef(temporalSource, feature.evidenceIds)];
  const label = feature.seriesKey.replace("_", " ");
  const meanDisplay = feature.unit === "m/s"
    ? speedDisplayMps(feature.statistics.mean)
    : { displayValue: compact(feature.statistics.mean, feature.unit === "W" || feature.unit === "bpm" || feature.unit === "rpm" ? 0 : 2), displayUnit: feature.unit };
  claims.push(claim(rideId, `${feature.seriesKey}.mean`, feature.statistics.mean, feature.unit, refs, {
    quality,
    formulaVersion: feature.formulaVersion,
    supports: [`${feature.seriesKey}_level`],
    prohibits: ["stability_from_mean", "causation_from_level"],
    displayValue: meanDisplay.displayValue,
    displayUnit: meanDisplay.displayUnit,
    text: `${label} weighted mean`,
  }));
  if (feature.stability.eligible) {
    claims.push(claim(rideId, `${feature.seriesKey}.coefficientOfVariation`, feature.statistics.coefficientOfVariation ?? 0, "ratio", refs, {
      quality,
      formulaVersion: feature.formulaVersion,
      supports: [`${feature.seriesKey}_stability`],
      prohibits: ["ability_change", "causation"],
      displayValue: compact((feature.statistics.coefficientOfVariation ?? 0) * 100, 1),
      displayUnit: "%",
    }));
  }
  if (feature.stageComparison.eligible && finite(feature.stageComparison.lastMinusFirst)) {
    const drift = feature.stageComparison.lastMinusFirst;
    const driftDisplay = feature.unit === "m/s" ? speedDisplayMps(drift) : { displayValue: compact(drift, 1), displayUnit: feature.unit };
    claims.push(claim(rideId, `${feature.seriesKey}.lastMinusFirst`, drift, feature.unit, refs, {
      quality,
      formulaVersion: feature.formulaVersion,
      supports: [`${feature.seriesKey}_stage_comparison`],
      prohibits: ["trend_beyond_current_ride", "causation"],
      displayValue: driftDisplay.displayValue,
      displayUnit: driftDisplay.displayUnit,
    }));
  }
}

function movingPowerSeconds(record: RideRecord, temporal: RideTemporalFeatureSnapshotV2): PowerSecondData {
  const segments: number[][] = [];
  let current: number[] | undefined;
  let previousEnd: number | undefined;
  for (let index = 1; index < record.series.points.length; index += 1) {
    const previous = record.series.points[index - 1]!;
    const point = record.series.points[index]!;
    const start = previous.elapsedTimeS;
    const end = point.elapsedTimeS;
    const duration = finite(start) && finite(end) ? end - start : undefined;
    const stopped = finite(start) && finite(end) && temporal.stops.some((stop) => overlap(start, end, stop.startElapsedTimeS, stop.endElapsedTimeS) > 0);
    const distance = finite(previous.distanceM) && finite(point.distanceM) ? point.distanceM - previous.distanceM : undefined;
    const speed = finite(duration) && duration > 0 && finite(distance) ? distance / duration : point.speedMps;
    const usable = finite(start) && finite(end) && finite(duration) && duration > 0 && duration <= MAX_CONTINUOUS_INTERVAL_S
      && !stopped && finite(speed) && speed >= MOVING_SPEED_MPS && finite(point.powerW) && point.powerW >= 0 && point.powerW <= 3_000;
    if (!usable) {
      current = undefined;
      previousEnd = undefined;
      continue;
    }
    const seconds = Math.max(1, Math.round(duration));
    if (!current || previousEnd === undefined || Math.abs(previousEnd - start) > 0.01) {
      current = [];
      segments.push(current);
    }
    current.push(...Array.from({ length: seconds }, () => point.powerW!));
    previousEnd = end;
  }
  return { segments, allValues: segments.flat() };
}

function normalizedPower(segments: number[][]): number | undefined {
  const rollingFourthPowers: number[] = [];
  for (const segment of segments) {
    if (segment.length < 30) continue;
    let total = segment.slice(0, 30).reduce((sum, value) => sum + value, 0);
    rollingFourthPowers.push((total / 30) ** 4);
    for (let index = 30; index < segment.length; index += 1) {
      total += segment[index]! - segment[index - 30]!;
      rollingFourthPowers.push((total / 30) ** 4);
    }
  }
  if (!rollingFourthPowers.length) return undefined;
  return (rollingFourthPowers.reduce((sum, value) => sum + value, 0) / rollingFourthPowers.length) ** 0.25;
}

function powerZones(ftpW: number, values: number[]): PowerZone[] {
  const tests: Array<[PowerZone["key"], (value: number) => boolean]> = [
    ["z1", (value) => value < ftpW * 0.55],
    ["z2", (value) => value >= ftpW * 0.55 && value < ftpW * 0.76],
    ["z3", (value) => value >= ftpW * 0.76 && value < ftpW * 0.91],
    ["z4", (value) => value >= ftpW * 0.91 && value < ftpW * 1.06],
    ["z5", (value) => value >= ftpW * 1.06 && value < ftpW * 1.21],
    ["z6", (value) => value >= ftpW * 1.21 && value < ftpW * 1.51],
    ["z7", (value) => value >= ftpW * 1.51],
  ];
  return tests.map(([key, matches]) => {
    const durationS = values.filter(matches).length;
    return { key, durationS, share: values.length ? durationS / values.length : 0 };
  });
}

function addZoneClaims(
  claims: V2AnalysisClaim[],
  rideId: string,
  prefix: "heartRate" | "cadence",
  distribution: ZoneDistribution,
  derivedSource: SourceSpec,
): EvidenceSourceRef[] {
  if (distribution.unavailableReason) return [];
  const evidenceId = derivedEvidence(rideId, `${prefix}-zones`);
  const refs = [sourceRef(derivedSource, [evidenceId])];
  for (const bin of distribution.bins) {
    if (bin.durationS <= 0) continue;
    claims.push(claim(rideId, `${prefix}.zone.${bin.key}`, bin.durationS, "s", refs, {
      kind: "advanced",
      formulaVersion: distribution.rulesVersion,
      supports: [`${prefix}_zone_distribution`],
      prohibits: ["medical_diagnosis", "causation"],
      displayValue: compact(bin.share * 100, 0),
      displayUnit: "%",
    }));
  }
  return refs;
}

function addSegmentClaims(
  claims: V2AnalysisClaim[],
  rideId: string,
  segments: SegmentWindowV2[],
  windowsSource: SourceSpec,
): Map<SegmentWindowV2["kind"], EvidenceSourceRef[]> {
  const refsByKind = new Map<SegmentWindowV2["kind"], EvidenceSourceRef[]>();
  for (const segment of segments) {
    if (segment.unavailableReason) continue;
    const refs = [sourceRef(windowsSource, segment.evidenceIds)];
    refsByKind.set(segment.kind, [...(refsByKind.get(segment.kind) ?? []), ...refs]);
    const boundaryValue = finite(segment.startElapsedTimeS) && finite(segment.endElapsedTimeS)
      ? segment.endElapsedTimeS - segment.startElapsedTimeS
      : finite(segment.startDistanceM) && finite(segment.endDistanceM) ? segment.endDistanceM - segment.startDistanceM : undefined;
    if (finite(boundaryValue)) {
      const spanUnit = finite(segment.startElapsedTimeS) ? "s" : "m";
      const spanDisplay = spanUnit === "s"
        ? durationDisplayS(boundaryValue)
        : { displayValue: compact(boundaryValue, 0), displayUnit: spanUnit };
      claims.push(claim(rideId, `segment.${segment.kind}.${segment.id}.span`, boundaryValue,
        spanUnit, refs, {
          kind: "advanced",
          formulaVersion: segment.sourceRulesVersion,
          supports: [`${segment.kind}_segment`],
          prohibits: ["ability_change", "causation"],
          displayValue: spanDisplay.displayValue,
          displayUnit: spanDisplay.displayUnit,
          ...(segment.mergedFromCount ? { text: `merged from ${segment.mergedFromCount} adjacent ${segment.kind} segments` } : {}),
        }));
    }
    // S2-05: climb facts the detail page shows (category, distance, net gain,
    // average grade, difficulty) become citable claims alongside the window
    // statistics, so the climb dimension can speak about gradient and gain —
    // not only duration and sensor means.
    if (segment.kind === "climb" && segment.climbFacts) {
      // S2-05: climb facts (category, distance, gain, grade, difficulty) are
      // terrain-context evidence — they only feed the climb dimension. Sensor
      // packets (power/cadence/cross) still receive the climb span, sensor
      // means, and relation claims, which carry the per-segment context they
      // need. This keeps the four fact claims from being duplicated into every
      // climb-touching question.
      const facts = segment.climbFacts;
      claims.push(claim(rideId, `segment.climb.${segment.id}.distanceM`, facts.distanceM, "m", refs, {
        kind: "advanced", formulaVersion: segment.sourceRulesVersion,
        supports: ["climb_fact"], prohibits: ["ability_change", "causation"],
        displayValue: compact(facts.distanceM / 1_000, 1), displayUnit: "km",
      }));
      claims.push(claim(rideId, `segment.climb.${segment.id}.netElevationGainM`, facts.netElevationGainM, "m", refs, {
        kind: "advanced", formulaVersion: segment.sourceRulesVersion,
        supports: ["climb_fact"], prohibits: ["ability_change", "causation"],
        displayValue: compact(facts.netElevationGainM, 0), displayUnit: "m",
      }));
      claims.push(claim(rideId, `segment.climb.${segment.id}.averageGrade`, facts.averageGrade, "ratio", refs, {
        kind: "advanced", formulaVersion: segment.sourceRulesVersion,
        supports: ["climb_fact"], prohibits: ["ability_change", "causation"],
        displayValue: compact(facts.averageGrade * 100, 1), displayUnit: "%",
      }));
      claims.push(claim(rideId, `segment.climb.${segment.id}.difficultyScore`, facts.difficultyScore, "score", refs, {
        kind: "advanced", formulaVersion: segment.sourceRulesVersion,
        supports: ["climb_fact"], prohibits: ["ability_change", "causation"],
        displayValue: compact(facts.difficultyScore, 0), displayUnit: "score",
        text: `climb category ${facts.category}`,
      }));
    }
    for (const [sensor, stats] of Object.entries(segment.sensorMeans) as [Sensor, NonNullable<SegmentWindowV2["sensorMeans"][Sensor]>][]) {
      const sensorUnit = sensor === "speed" ? "m/s" : sensor === "heart_rate" ? "bpm" : sensor === "power" ? "W" : "rpm";
      const sensorDisplay = sensor === "speed"
        ? speedDisplayMps(stats.mean)
        : { displayValue: compact(stats.mean, sensorUnit === "W" || sensorUnit === "bpm" || sensorUnit === "rpm" ? 0 : 2), displayUnit: sensorUnit };
      claims.push(claim(rideId, `segment.${segment.kind}.${segment.id}.${sensor}.mean`, stats.mean,
        sensorUnit, refs, {
          kind: "advanced",
          formulaVersion: RIDE_CAPABILITY_CLAIMS_RULES_VERSION,
          supports: [`${segment.kind}_${sensor}_observation`],
          prohibits: ["stability_from_mean", "causation"],
          displayValue: sensorDisplay.displayValue,
          displayUnit: sensorDisplay.displayUnit,
        }));
    }
  }
  return refsByKind;
}

// S2-03 (PD-AI-16): representative-window selection is deterministic —
// (1) longest shared time, (2) highest common coverage (next highest when it
// repeats pick 1), (3) lowest common coverage as the anomaly floor. Duplicates
// fall through in order. With three or fewer windows every window is shown.
const MAX_FIXED_RELATION_REPRESENTATIVES = 3;

export interface RelationRepresentative {
  window: JointWindowV2;
  index: number;
  reason: string;
}

export function selectRelationRepresentatives(windows: JointWindowV2[]): RelationRepresentative[] {
  const indexed = windows.map((window, index) => ({ window, index: index + 1 }));
  if (windows.length <= MAX_FIXED_RELATION_REPRESENTATIVES) {
    return indexed.map((item) => ({ ...item, reason: `all ${windows.length} fixed windows shown` }));
  }
  const picked: RelationRepresentative[] = [];
  const takeNext = (ordered: typeof indexed, reason: string): void => {
    const candidate = ordered.find((item) => !picked.some((chosen) => chosen.window === item.window));
    if (candidate) picked.push({ ...candidate, reason });
  };
  takeNext([...indexed].sort((a, b) => b.window.sharedTimeS - a.window.sharedTimeS), "longest shared time");
  takeNext([...indexed].sort((a, b) => b.window.commonCoverage - a.window.commonCoverage), "highest common coverage");
  takeNext([...indexed].sort((a, b) => a.window.commonCoverage - b.window.commonCoverage), "lowest common coverage");
  return picked;
}

// Mean common coverage of the early/middle/late thirds of the ride
// (chronological). Undefined when fewer than three windows exist.
function thirdsCoverageMeans(windows: JointWindowV2[]): number[] | undefined {
  if (windows.length < 3) return undefined;
  const sorted = [...windows].sort((a, b) => a.startElapsedTimeS - b.startElapsedTimeS);
  const base = Math.floor(sorted.length / 3);
  const sizes = [base, base, base];
  for (let remainder = sorted.length % 3, slot = 0; remainder > 0; remainder -= 1, slot += 1) sizes[slot] += 1;
  const means: number[] = [];
  let offset = 0;
  for (const size of sizes) {
    const slice = sorted.slice(offset, offset + size);
    means.push(slice.reduce((total, window) => total + window.commonCoverage, 0) / slice.length);
    offset += size;
  }
  return means;
}

function addRelationClaims(
  claims: V2AnalysisClaim[],
  rideId: string,
  windows: JointWindowV2[],
  windowsSource: SourceSpec,
): EvidenceSourceRef[] {
  const allRefs: EvidenceSourceRef[] = [];
  const fixedByPair = new Map<string, JointWindowV2[]>();
  for (const window of windows) {
    const pair = window.seriesKeys.join("-");
    fixedByPair.set(pair, [...(fixedByPair.get(pair) ?? []), window]);
  }

  // Fixed windows: one aggregate claim plus at most three representatives
  // per sensor pair (S2-03 / PD-AI-16). The aggregate claim cites the
  // representative windows' evidence so the claim stays within a bounded
  // evidence footprint; the packet limitations disclose the aggregation.
  for (const [pair, pairWindows] of fixedByPair) {
    if (!pairWindows.length) continue;
    const representatives = selectRelationRepresentatives(pairWindows);
    const aggregateRefs = [sourceRef(windowsSource, unique(representatives.flatMap((item) => item.window.evidenceIds)))];
    allRefs.push(...aggregateRefs);
    const coverages = pairWindows.map((window) => window.commonCoverage);
    const meanCoverage = coverages.reduce((total, value) => total + value, 0) / coverages.length;
    const totalSharedS = pairWindows.reduce((total, window) => total + window.sharedTimeS, 0);
    const thirds = thirdsCoverageMeans(pairWindows);
    claims.push(claim(rideId, `relation.fixed.${pair}.aggregate`, meanCoverage, "ratio", aggregateRefs, {
      kind: "relation",
      formulaVersion: RIDE_CAPABILITY_CLAIMS_RULES_VERSION,
      supports: ["same_window_observation"],
      prohibits: ["causation", "response_order", "trend"],
      displayValue: compact(meanCoverage * 100, 0),
      displayUnit: "%",
      text: `aggregated: ${pair} relation aggregated across ${pairWindows.length} fixed windows`
        + ` (coverage mean ${compact(meanCoverage * 100, 0)}%`
        + `, min ${compact(Math.min(...coverages) * 100, 0)}%`
        + `, max ${compact(Math.max(...coverages) * 100, 0)}%`
        + `, total shared time ${compact(totalSharedS, 0)} s`
        + (thirds ? `, thirds coverage mean ${thirds.map((value) => `${compact(value * 100, 0)}%`).join("/")}` : "")
        + ")",
      aggregatedFromCount: pairWindows.length,
    }));
    for (const representative of representatives) {
      const refs = [sourceRef(windowsSource, representative.window.evidenceIds)];
      allRefs.push(...refs);
      claims.push(claim(rideId, `relation.fixed.${pair}.rep.${representative.index}`, representative.window.commonCoverage, "ratio", refs, {
        kind: "relation",
        formulaVersion: representative.window.rulesVersion,
        supports: ["same_window_observation"],
        prohibits: ["causation", "response_order", "trend"],
        displayValue: compact(representative.window.commonCoverage * 100, 0),
        displayUnit: "%",
        text: `${pair} representative window ${representative.index} (${representative.reason})`
          + `: shared ${compact(representative.window.sharedTimeS, 0)} s in the same window`,
      }));
    }
  }

  return allRefs;
}

function missingDependency(capabilities: Map<EvidenceCapabilityKey, V2EvidenceCapability>, keys: readonly EvidenceCapabilityKey[]): string | undefined {
  const missing = keys.filter((key) => capabilities.get(key)?.status === "unavailable");
  return missing.length ? `DEPENDENCY_UNAVAILABLE:${missing.join(",")}` : undefined;
}

export function buildRideCapabilityClaimsV2(
  record: RideRecord,
  options: BuildRideCapabilityClaimsV2Options = {},
): RideCapabilityClaimSnapshotV2 {
  const rideId = record.activity.rideId;
  const profile = options.profile ?? undefined;
  const temporal = options.temporal ?? buildRideTemporalFeaturesV2(record);
  const windows = options.windows ?? buildRideTemporalWindowsV2(record);
  if (temporal.rideId !== rideId || windows.rideId !== rideId) throw new Error("S1 snapshots do not match the ride");

  const activitySource = source(rideId, "activity", "activity", record.activity.schemaVersion);
  for (const metric of Object.values(record.activity.metrics)) if (metric?.evidenceId) activitySource.evidenceIds.add(metric.evidenceId);
  activitySource.evidenceIds.add(derivedEvidence(rideId, "activity-contract"));
  const seriesSource = source(rideId, "series", "series", record.series.schemaVersion);
  seriesSource.evidenceIds.add(derivedEvidence(rideId, "series-contract"));
  for (const key of record.series.availableSeries) seriesSource.evidenceIds.add(derivedEvidence(rideId, `series-contract-${key}`));
  const temporalSource = source(rideId, "temporal", "summary", temporal.rulesVersion);
  temporalSource.evidenceIds.add(derivedEvidence(rideId, "temporal-axis"));
  temporal.series.flatMap((item) => item.evidenceIds).forEach((id) => temporalSource.evidenceIds.add(id));
  const windowsSource = source(rideId, "windows", "summary", windows.rulesVersion,
    windows.unavailableReason ? "unavailable" : "available", windows.unavailableReason);
  windows.powerPeaks.flatMap((item) => item.evidenceIds).forEach((id) => windowsSource.evidenceIds.add(id));
  windows.segments.flatMap((item) => item.evidenceIds).forEach((id) => windowsSource.evidenceIds.add(id));
  windows.jointWindows.flatMap((item) => item.evidenceIds).forEach((id) => windowsSource.evidenceIds.add(id));
  // route-shape-derived terrain distances are independent of the time axis and
  // stop placement, so they live on their own source (available whenever
  // terrainDistances exists) instead of on windowsSource — which flips to
  // unavailable on UNLOCATED_STOP_TIME and would otherwise orphan these claims
  // into CLAIM_SOURCE_INVALID (upload-f95e988a, 2026-10-07). Climb/cruise/terrain
  // segment windows and joint windows stay on windowsSource: their sensor means
  // genuinely depend on a placed time axis.
  const routeShapeSource = windows.terrainDistances
    ? source(rideId, "route-shape", "summary", windows.terrainDistances.rulesVersion)
    : undefined;
  const profileHasFacts = Boolean(profile && (profile.age || profile.heightCm || profile.weightKg || profile.maxHeartRate || profile.ftp));
  const profileSource = source(rideId, "profile", "profile", profile ? `${profile.schemaVersion}:${profile.updatedAt}` : "profile-v0.1",
    profileHasFacts ? "available" : "missing", profileHasFacts ? undefined : "PROFILE_MISSING_OR_EMPTY");
  if (profileHasFacts) {
    for (const key of ["age", "heightCm", "weightKg", "maxHeartRate", "ftp"] as const) {
      if (profile?.[key]) profileSource.evidenceIds.add(derivedEvidence(rideId, `profile-${key}-${profile[key]!.updatedAt}`));
    }
  }
  const derivedSource = source(rideId, "capability-claims", "summary", RIDE_CAPABILITY_CLAIMS_RULES_VERSION);

  const claims: V2AnalysisClaim[] = [];
  const limitations: string[] = [];
  const capabilities = new Map<EvidenceCapabilityKey, V2EvidenceCapability>();
  for (const key of evidenceCapabilityKeys) capabilities.set(key, unavailableCapability(key, [], "RULE_NOT_IMPLEMENTED"));

  const temporalRef = [sourceRef(temporalSource, [derivedEvidence(rideId, "temporal-axis")])];
  const timed = temporal.axis === "time" && !temporal.axisIncomplete && temporal.unlocatedStopTolerated;
  if (timed) {
    capabilities.set("timing", availableCapability("timing", [], temporalRef, "valid", ["current_ride_timing"], []));
    const continuityQuality: Exclude<EvidenceQuality, "unavailable"> = temporal.gaps.length ? "soft" : "valid";
    capabilities.set("sensorContinuity", availableCapability("sensorContinuity", ["timing"], temporalRef, continuityQuality,
      ["continuity_limit"], ["bridge_recording_gap"]));
    capabilities.set("stops", availableCapability("stops", ["timing"], temporalRef, "valid", ["stop_observation"], ["stop_as_moving_performance"]));
    const timing = buildRideTimingSummary(record);
    const timingEvidence = derivedEvidence(rideId, "timing-moving-duration");
    const timingRefs = [sourceRef(derivedSource, [timingEvidence])];
    if (finite(timing.movingTimeS)) {
      const durationDisplay = durationDisplayS(timing.movingTimeS);
      claims.push(claim(rideId, "timing.movingDurationS", timing.movingTimeS, "s", timingRefs, {
        kind: "advanced", formulaVersion: timing.rulesVersion, supports: ["current_ride_timing"], prohibits: ["training_effect"],
        displayValue: durationDisplay.displayValue, displayUnit: durationDisplay.displayUnit,
      }));
    }
    claims.push(claim(rideId, "stops.count", temporal.stops.length, "count", temporalRef, {
      kind: "advanced", formulaVersion: temporal.rulesVersion, supports: ["stop_observation"], prohibits: ["stop_cause"],
      displayValue: String(temporal.stops.length), displayUnit: "count",
    }));
  } else {
    const reason = !temporal.unlocatedStopTolerated ? "UNLOCATED_STOP_TIME" : temporal.axisIncomplete ? "AXIS_INCOMPLETE" : "TIME_AXIS_REQUIRED";
    capabilities.set("timing", unavailableCapability("timing", [], reason));
    capabilities.set("sensorContinuity", unavailableCapability("sensorContinuity", ["timing"], reason));
    capabilities.set("stops", unavailableCapability("stops", ["timing"], reason));
  }

  const metricEvidence = (key: keyof RideRecord["activity"]["metrics"]): string[] => {
    const id = record.activity.metrics[key]?.evidenceId;
    return id ? [id] : [];
  };
  const distanceIds = metricEvidence("distanceM");
  if (distanceIds.length || record.series.availableSeries.includes("distance")) {
    const ids = distanceIds.length ? distanceIds : [derivedEvidence(rideId, "series-contract-distance")];
    const refs = distanceIds.length ? [sourceRef(activitySource, ids)] : [sourceRef(seriesSource, ids)];
    capabilities.set("distance", availableCapability("distance", [], refs, "valid", ["ride_distance"], []));
  } else capabilities.set("distance", unavailableCapability("distance", [], "SOURCE_UNAVAILABLE"));

  // S2-05 (FR-01: every detail-page riding fact must reach the model): the
  // recorded summary metrics — total distance, elevation gain/loss, elapsed
  // duration and activity energy — become recorded-provenance claims. Device
  // aggregates stay separate from the series-recomputed statistics above; both
  // calibers are preserved, never merged.
  const recordedMetricClaims: Array<{
    key: keyof RideRecord["activity"]["metrics"];
    claimKey: string;
    unit: string;
    supports: string[];
    displayValue: (value: number) => string;
    displayUnit: string;
  }> = [
    { key: "distanceM", claimKey: "metric.distanceM", unit: "m", supports: ["ride_distance"],
      displayValue: (value) => compact(value / 1_000, 1), displayUnit: "km" },
    { key: "elevationGainM", claimKey: "metric.elevationGainM", unit: "m", supports: ["elevation_context"],
      displayValue: (value) => compact(value, 0), displayUnit: "m" },
    { key: "elevationLossM", claimKey: "metric.elevationLossM", unit: "m", supports: ["elevation_context"],
      displayValue: (value) => compact(value, 0), displayUnit: "m" },
    { key: "activityEnergyKcal", claimKey: "metric.activityEnergyKcal", unit: "kcal", supports: ["activity_energy"],
      displayValue: (value) => compact(value, 0), displayUnit: "kcal" },
  ];
  for (const definition of recordedMetricClaims) {
    const metric = record.activity.metrics[definition.key];
    if (!metric || typeof metric.value !== "number" || !Number.isFinite(metric.value)) continue;
    const ids = metricEvidence(definition.key);
    if (!ids.length) continue;
    claims.push(claim(rideId, definition.claimKey, metric.value, definition.unit, [sourceRef(activitySource, ids)], {
      kind: "advanced", provenance: "recorded", quality: metric.qualityStatus === "valid" ? "valid" : "soft",
      supports: definition.supports, prohibits: ["causation"],
      displayValue: definition.displayValue(metric.value), displayUnit: definition.displayUnit,
    }));
  }
  // Elapsed duration is the device/rule total including stops, complementing
  // the moving-duration claim emitted with the timing capability above.
  const elapsedMetric = record.activity.metrics.elapsedTimeS;
  if (timed && elapsedMetric && typeof elapsedMetric.value === "number" && Number.isFinite(elapsedMetric.value)) {
    const ids = metricEvidence("elapsedTimeS");
    if (ids.length) {
      const durationDisplay = durationDisplayS(elapsedMetric.value);
      claims.push(claim(rideId, "metric.elapsedDurationS", elapsedMetric.value, "s", [sourceRef(activitySource, ids)], {
        kind: "advanced", provenance: "recorded", quality: elapsedMetric.qualityStatus === "valid" ? "valid" : "soft",
        supports: ["current_ride_timing"], prohibits: ["training_effect"],
        displayValue: durationDisplay.displayValue, displayUnit: durationDisplay.displayUnit,
        text: "elapsed duration including stops",
      }));
    }
  }

  if (record.series.availableSeries.includes("route")) {
    const refs = [sourceRef(seriesSource, [derivedEvidence(rideId, "series-contract-route")])];
    capabilities.set("route", availableCapability("route", [], refs, "valid", ["relative_route_identity"], ["precise_location"]));
  } else capabilities.set("route", unavailableCapability("route", [], "SOURCE_UNAVAILABLE"));

  const sensorCapabilityMap: Record<Sensor, EvidenceCapabilityKey> = {
    speed: "speed", heart_rate: "heartRate", power: "power", cadence: "cadence",
  };
  for (const sensor of Object.keys(sensorCapabilityMap) as Sensor[]) {
    const feature = featureByKey(temporal, sensor);
    addSeriesClaims(claims, rideId, feature, temporalSource);
    const key = sensorCapabilityMap[sensor];
    const quality = qualityFor(feature);
    if (quality === "unavailable") {
      capabilities.set(key, unavailableCapability(key, [], feature.unavailable.join(",") || "SOURCE_UNAVAILABLE"));
      continue;
    }
    const refs = [sourceRef(temporalSource, feature.evidenceIds)];
    capabilities.set(key, availableCapability(key, [], refs, quality, [`${sensor}_level`], ["stability_from_mean", "causation"]));
  }

  const speed = featureByKey(temporal, "speed");
  const power = featureByKey(temporal, "power");
  const heartRate = featureByKey(temporal, "heart_rate");
  const cadence = featureByKey(temporal, "cadence");
  const stabilityCapabilities: Array<[EvidenceCapabilityKey, TemporalSeriesFeatureV2, EvidenceCapabilityKey]> = [
    ["speedStability", speed, "speed"], ["powerStability", power, "power"],
  ];
  for (const [key, feature, dependency] of stabilityCapabilities) {
    const reason = missingDependency(capabilities, [dependency, "sensorContinuity"]);
    if (reason || !feature.stability.eligible) capabilities.set(key, unavailableCapability(key, [dependency, "sensorContinuity"], reason ?? feature.stability.reason ?? "INSUFFICIENT_QUALITY"));
    else capabilities.set(key, availableCapability(key, [dependency, "sensorContinuity"], [sourceRef(temporalSource, feature.evidenceIds)],
      qualityFor(feature) === "valid" ? "valid" : "soft", [`${feature.seriesKey}_stability`], ["ability_change", "causation"]));
  }

  const peakClaims = windows.powerPeaks.filter((peak) => finite(peak.meanPowerW));
  if (!windows.unavailableReason && peakClaims.length) {
    const refs = [sourceRef(windowsSource, unique(peakClaims.flatMap((peak) => peak.evidenceIds)))];
    const quality: Exclude<EvidenceQuality, "unavailable"> = peakClaims.length === 3 ? "valid" : "soft";
    capabilities.set("powerPeaks", availableCapability("powerPeaks", ["power", "sensorContinuity"], refs, quality,
      ["short_duration_power_peak"], ["ability_change", "bridge_recording_gap"]));
    for (const peak of peakClaims) {
      claims.push(claim(rideId, `power.peakAverage.${peak.durationS}s`, peak.meanPowerW!, "W", [sourceRef(windowsSource, peak.evidenceIds)], {
        kind: "advanced", quality, formulaVersion: peak.rulesVersion, supports: ["short_duration_power_peak"],
        prohibits: ["ability_change", "bridge_recording_gap"], displayValue: compact(peak.meanPowerW!, 0), displayUnit: "W",
        // The window length is part of the claim text so "10 s / 20 s / 30 s
        // peak" wording copies a whitelisted number instead of deriving one
        // from the claim key.
        text: `contiguous ${peak.durationS} s peak average power`,
      }));
    }
  } else capabilities.set("powerPeaks", unavailableCapability("powerPeaks", ["power", "sensorContinuity"],
    windows.unavailableReason ?? "INSUFFICIENT_CONTINUOUS_DATA"));

  const segmentRefs = windows.unavailableReason
    ? new Map<SegmentWindowV2["kind"], EvidenceSourceRef[]>()
    : addSegmentClaims(claims, rideId, windows.segments, windowsSource);
  if (record.series.availableSeries.includes("elevation") || segmentRefs.has("climb") || segmentRefs.has("terrain")) {
    const evidenceId = record.series.availableSeries.includes("elevation")
      ? derivedEvidence(rideId, "series-contract-elevation")
      : unique([...(segmentRefs.get("climb") ?? []), ...(segmentRefs.get("terrain") ?? [])].flatMap((ref) => ref.evidenceIds))[0]!;
    const refs = record.series.availableSeries.includes("elevation")
      ? [sourceRef(seriesSource, [evidenceId])]
      : [sourceRef(windowsSource, [evidenceId])];
    capabilities.set("elevation", availableCapability("elevation", [], refs, "valid", ["elevation_context"], []));
  } else capabilities.set("elevation", unavailableCapability("elevation", [], "SOURCE_UNAVAILABLE"));

  for (const [kind, key, dependencies] of [
    ["cruise", "cruise", ["speed", "timing"]],
    ["terrain", "terrain", ["elevation"]],
    ["climb", "climbing", ["elevation", "timing"]],
  ] as const) {
    const refs = segmentRefs.get(kind);
    const dependencyReason = missingDependency(capabilities, dependencies);
    if (refs?.length && !dependencyReason) {
      capabilities.set(key, availableCapability(key, dependencies, refs, "valid", [`${kind}_segment`], ["ability_change", "causation"]));
    } else {
      capabilities.set(key, unavailableCapability(key, dependencies, dependencyReason ?? "SOURCE_UNAVAILABLE"));
    }
  }

  // S2-05: aggregate terrain distances (climb/flat/descent mileage, trend and
  // local calibers) from the route-shape summary — the same figures the detail
  // page shows — become citable claims for the climb and pacing dimensions.
  if (windows.terrainDistances) {
    const terrain = windows.terrainDistances;
    const refs = [sourceRef(routeShapeSource!, terrain.evidenceIds)];
    const terrainMetricClaims: Array<{
      claimKey: string;
      value: number;
      supports: string[];
    }> = [
      { claimKey: "terrain.trendClimbDistanceM", value: terrain.trendClimbDistanceM, supports: ["terrain_segment"] },
      { claimKey: "terrain.trendFlatDistanceM", value: terrain.trendFlatDistanceM, supports: ["terrain_segment"] },
      { claimKey: "terrain.trendDescentDistanceM", value: terrain.trendDescentDistanceM, supports: ["terrain_segment"] },
      { claimKey: "terrain.localClimbDistanceM", value: terrain.climbDistanceM, supports: ["terrain_segment"] },
      { claimKey: "terrain.localFlatDistanceM", value: terrain.flatDistanceM, supports: ["terrain_segment"] },
      { claimKey: "terrain.localDescentDistanceM", value: terrain.descentDistanceM, supports: ["terrain_segment"] },
    ];
    for (const definition of terrainMetricClaims) {
      claims.push(claim(rideId, definition.claimKey, definition.value, "m", refs, {
        kind: "advanced", formulaVersion: terrain.rulesVersion,
        supports: definition.supports, prohibits: ["ability_change", "causation"],
        displayValue: compact(definition.value / 1_000, 1), displayUnit: "km",
      }));
    }
    claims.push(claim(rideId, "terrain.classifiedCoverageRatio", terrain.coverageRatio, "ratio", refs, {
      kind: "advanced", formulaVersion: terrain.rulesVersion,
      supports: ["terrain_segment"], prohibits: ["ability_change", "causation"],
      displayValue: compact(terrain.coverageRatio * 100, 0), displayUnit: "%",
      text: "share of moving distance with a classified terrain type",
    }));
    // PD-AI-16-style disclosure: only the longest N terrain runs per type are
    // delivered as segment windows; the counts below state what was dropped.
    const terrainCountClaims: Array<{ claimKey: string; label: string; total: number; shown: number }> = [
      { claimKey: "terrain.climbRunCount", label: "climb", total: terrain.segmentCounts.climb, shown: terrain.representativeCounts.climb },
      { claimKey: "terrain.flatRunCount", label: "flat", total: terrain.segmentCounts.flat, shown: terrain.representativeCounts.flat },
      { claimKey: "terrain.descentRunCount", label: "descent", total: terrain.segmentCounts.descent, shown: terrain.representativeCounts.descent },
    ];
    for (const definition of terrainCountClaims) {
      claims.push(claim(rideId, definition.claimKey, definition.total, "count", refs, {
        kind: "advanced", formulaVersion: terrain.rulesVersion,
        supports: ["terrain_segment"], prohibits: ["ability_change", "causation"],
        displayValue: String(definition.total), displayUnit: "count",
        ...(definition.total > definition.shown ? { aggregatedFromCount: definition.total } : {}),
        text: `${definition.total} merged ${definition.label} terrain runs; ${definition.shown} longest shown as representative segments`,
      }));
    }
  }

  // S2-05: PD-AI-16-style disclosure for climb representative selection — the
  // climb dimension sees which share of the identified climbs the windows carry.
  if (windows.climbRepresentativeCounts && windows.climbRepresentativeCounts.totalClimbs > 0) {
    const climbEvidenceIds = windows.segments.filter((segment) => segment.kind === "climb")
      .flatMap((segment) => segment.evidenceIds);
    const refs = [sourceRef(windowsSource, climbEvidenceIds)];
    const counts = windows.climbRepresentativeCounts;
    claims.push(claim(rideId, "climb.representativeClimbCount", counts.totalClimbs, "count", refs, {
      kind: "advanced", formulaVersion: windows.rulesVersion,
      supports: ["climb_fact"], prohibits: ["ability_change", "causation"],
      displayValue: `${counts.representativeClimbs}/${counts.totalClimbs}`, displayUnit: "count",
      ...(counts.totalClimbs > counts.representativeClimbs ? { aggregatedFromCount: counts.totalClimbs } : {}),
      text: counts.totalClimbs > counts.representativeClimbs
        ? `${counts.totalClimbs} climbs identified; ${counts.representativeClimbs} hardest kept as representative segments (ranked by category, difficulty, distance)`
        : `${counts.totalClimbs} climbs identified; all kept as segment windows`,
    }));
  }

  // S2-05 (user decision 2026-10-06, option B): cross-sensor pairing evidence
  // is the fixed-window aggregate only; segments no longer emit relation claims.
  const allRelations = windows.jointWindows;
  const relationRefs = windows.unavailableReason ? [] : addRelationClaims(claims, rideId, allRelations, windowsSource);
  if (relationRefs.length) capabilities.set("crossSensorAlignment", availableCapability("crossSensorAlignment", ["sensorContinuity"], relationRefs,
    "valid", ["same_window_observation"], ["causation", "response_order", "trend"]));
  else capabilities.set("crossSensorAlignment", unavailableCapability("crossSensorAlignment", ["sensorContinuity"],
    windows.unavailableReason ?? "NO_COMMON_WINDOW"));

  if (profileHasFacts) {
    const refs = [sourceRef(profileSource, [...profileSource.evidenceIds])];
    capabilities.set("userProfile", availableCapability("userProfile", [], refs, "valid", ["profile_dependent_calculation"], ["infer_missing_profile"]));
  } else capabilities.set("userProfile", unavailableCapability("userProfile", [], "PROFILE_MISSING_OR_EMPTY"));

  if (profile?.maxHeartRate && profileHasFacts) {
    const evidenceId = derivedEvidence(rideId, `profile-maxHeartRate-${profile.maxHeartRate.updatedAt}`);
    const refs = [sourceRef(profileSource, [evidenceId])];
    const quality: Exclude<EvidenceQuality, "unavailable"> = profile.maxHeartRate.source === "user_provided" ? "valid" : "soft";
    capabilities.set("maxHeartRateBaseline", availableCapability("maxHeartRateBaseline", ["userProfile"], refs, quality,
      ["heart_rate_zone_baseline"], ["medical_measurement"]));
    claims.push(claim(rideId, "profile.maxHeartRateBpm", profile.maxHeartRate.valueBpm, "bpm", refs, {
      kind: "advanced", provenance: profile.maxHeartRate.source === "user_provided" ? "recorded" : "estimated", quality,
      formulaVersion: profile.maxHeartRate.formulaVersion, supports: ["heart_rate_zone_baseline"], prohibits: ["medical_measurement"],
      displayValue: compact(profile.maxHeartRate.valueBpm, 0), displayUnit: "bpm",
    }));
  } else capabilities.set("maxHeartRateBaseline", unavailableCapability("maxHeartRateBaseline", ["userProfile"], "MAX_HEART_RATE_MISSING"));

  const heartRateZones = buildHeartRateZoneDistribution(record, profile);
  const heartRateZoneRefs = addZoneClaims(claims, rideId, "heartRate", heartRateZones, derivedSource);
  // PD-AI-29 (2026-10-07): precomputed high-intensity combined share (Z4+Z5) —
  // same rationale as the power-zone combined claim (aggregated summaries need
  // a deterministic calculated supply, not a relaxed number gate).
  if (!heartRateZones.unavailableReason) {
    const hrHighBins = heartRateZones.bins.filter((bin) => bin.key === "z4" || bin.key === "z5");
    const hrHighDurationS = hrHighBins.reduce((sum, bin) => sum + bin.durationS, 0);
    const hrHighShare = hrHighBins.reduce((sum, bin) => sum + bin.share, 0);
    if (hrHighDurationS > 0) {
      const hrHighRefs = [sourceRef(derivedSource, [derivedEvidence(rideId, "heartRate-zones")])];
      claims.push(claim(rideId, "heartRate.zone.highIntensityCombined", hrHighDurationS, "s", hrHighRefs, {
        kind: "advanced", formulaVersion: heartRateZones.rulesVersion,
        supports: ["heart_rate_zone_distribution"], prohibits: ["medical_diagnosis", "causation"],
        displayValue: compact(hrHighShare * 100, 0), displayUnit: "%",
      }));
    }
  }
  const hrZoneReason = missingDependency(capabilities, ["heartRate", "maxHeartRateBaseline", "timing"]);
  if (!hrZoneReason && heartRateZoneRefs.length) capabilities.set("heartRateZones", availableCapability("heartRateZones",
    ["heartRate", "maxHeartRateBaseline", "timing"], heartRateZoneRefs, heartRateZones.baseline?.source === "system_estimated" ? "soft" : "valid",
    ["heart_rate_zone_distribution"], ["medical_diagnosis"]));
  else capabilities.set("heartRateZones", unavailableCapability("heartRateZones", ["heartRate", "maxHeartRateBaseline", "timing"],
    hrZoneReason ?? heartRateZones.unavailableReason ?? "SOURCE_UNAVAILABLE"));

  const cadenceZones = buildCadenceZoneDistribution(record);
  const cadenceZoneRefs = addZoneClaims(claims, rideId, "cadence", cadenceZones, derivedSource);
  const cadenceZoneReason = missingDependency(capabilities, ["cadence", "timing"]);
  if (!cadenceZoneReason && cadenceZoneRefs.length) capabilities.set("cadenceZones", availableCapability("cadenceZones", ["cadence", "timing"], cadenceZoneRefs,
    "valid", ["cadence_zone_distribution"], ["efficiency", "causation"]));
  else capabilities.set("cadenceZones", unavailableCapability("cadenceZones", ["cadence", "timing"],
    cadenceZoneReason ?? cadenceZones.unavailableReason ?? "SOURCE_UNAVAILABLE"));

  if (heartRate.stageComparison.eligible && finite(heartRate.stageComparison.lastMinusFirst)) {
    const refs = [sourceRef(temporalSource, heartRate.evidenceIds)];
    capabilities.set("heartRateDrift", availableCapability("heartRateDrift", ["heartRate", "timing", "sensorContinuity"], refs,
      qualityFor(heartRate) === "valid" ? "valid" : "soft", ["heart_rate_stage_change"], ["recovery", "causation"]));
  } else capabilities.set("heartRateDrift", unavailableCapability("heartRateDrift", ["heartRate", "timing", "sensorContinuity"],
    heartRate.stageComparison.reason ?? "INSUFFICIENT_QUALITY"));

  const ftpAvailable = profile?.ftp?.trustStatus === "user_confirmed" && finite(profile.ftp.valueWatts) && profile.ftp.valueWatts > 0;
  if (ftpAvailable) {
    const ftpEvidence = derivedEvidence(rideId, `profile-ftp-${profile!.ftp!.updatedAt}`);
    const refs = [sourceRef(profileSource, [ftpEvidence])];
    capabilities.set("verifiedFtp", availableCapability("verifiedFtp", ["userProfile"], refs, "valid", ["ftp_dependent_calculation"], ["medical_threshold"]));
    claims.push(claim(rideId, "profile.verifiedFtpW", profile!.ftp!.valueWatts, "W", refs, {
      kind: "advanced", provenance: "recorded", supports: ["ftp_dependent_calculation"], prohibits: ["medical_threshold"],
      displayValue: compact(profile!.ftp!.valueWatts, 0), displayUnit: "W",
    }));
  } else capabilities.set("verifiedFtp", unavailableCapability("verifiedFtp", ["userProfile"], "FTP_MISSING_OR_UNCONFIRMED"));

  const powerSeconds = movingPowerSeconds(record, temporal);
  const powerQuality = qualityFor(power);
  const npQuality: EvidenceQuality = power.statistics && power.coverage >= MIN_NP_COVERAGE && temporal.longestGapS <= 60
    && timed && powerSeconds.segments.some((segment) => segment.length >= 30)
    ? powerQuality === "valid" && temporal.gaps.length === 0 ? "valid" : "soft" : "unavailable";
  const np = npQuality === "unavailable" ? undefined : normalizedPower(powerSeconds.segments);
  if (finite(np)) {
    const claimQuality: Exclude<EvidenceQuality, "unavailable"> = npQuality === "unavailable" ? "soft" : npQuality;
    const npEvidence = derivedEvidence(rideId, "power-normalized-contiguous");
    const refs = [sourceRef(derivedSource, [npEvidence]), sourceRef(temporalSource, power.evidenceIds)];
    capabilities.set("normalizedPower", availableCapability("normalizedPower", ["power", "timing", "sensorContinuity"], refs,
      claimQuality, ["normalized_power_output"], ["if_without_ftp", "tss_without_ftp", "bridge_recording_gap"]));
    claims.push(claim(rideId, "power.normalizedW", np, "W", refs, {
      kind: "advanced", quality: claimQuality, formulaVersion: RIDE_CONTIGUOUS_NP_RULES_VERSION,
      supports: ["normalized_power_output"], prohibits: ["if_without_ftp", "tss_without_ftp", "bridge_recording_gap"],
      displayValue: compact(np, 0), displayUnit: "W",
    }));
    if (profile?.weightKg?.value && profile.weightKg.value > 0) {
      const weightEvidence = derivedEvidence(rideId, `profile-weightKg-${profile.weightKg.updatedAt}`);
      const weightRefs = [...refs, sourceRef(profileSource, [weightEvidence])];
      claims.push(claim(rideId, "power.normalizedWkg", np / profile.weightKg.value, "W/kg", weightRefs, {
        kind: "advanced", quality: claimQuality, formulaVersion: RIDE_CONTIGUOUS_NP_RULES_VERSION,
        supports: ["relative_power_output"], prohibits: ["ability_change"], displayValue: compact(np / profile.weightKg.value, 2), displayUnit: "W/kg",
      }));
    } else limitations.push("power.weight:PROFILE_WEIGHT_MISSING");
  } else capabilities.set("normalizedPower", unavailableCapability("normalizedPower", ["power", "timing", "sensorContinuity"],
    timed ? "NP_QUALITY_OR_CONTINUITY_INSUFFICIENT" : "TIME_AXIS_REQUIRED"));

  const powerZoneDependency = missingDependency(capabilities, ["power", "verifiedFtp", "timing"]);
  if (!powerZoneDependency && ftpAvailable && powerSeconds.allValues.length) {
    const evidenceId = derivedEvidence(rideId, "power-zones");
    const refs = [sourceRef(derivedSource, [evidenceId]), sourceRef(profileSource, [derivedEvidence(rideId, `profile-ftp-${profile!.ftp!.updatedAt}`)])];
    const zones = powerZones(profile!.ftp!.valueWatts, powerSeconds.allValues);
    capabilities.set("powerZones", availableCapability("powerZones", ["power", "verifiedFtp", "timing"], refs,
      powerQuality === "valid" ? "valid" : "soft", ["power_zone_distribution"], ["training_effect"]));
    for (const zone of zones) {
      if (!zone.durationS) continue;
      claims.push(claim(rideId, `power.zone.${zone.key}`, zone.durationS, "s", refs, {
        kind: "advanced", quality: powerQuality === "valid" ? "valid" : "soft", formulaVersion: RIDE_POWER_ZONE_RULES_VERSION,
        supports: ["power_zone_distribution"], prohibits: ["training_effect"], displayValue: compact(zone.share * 100, 0), displayUnit: "%",
      }));
    }
    // PD-AI-29 (2026-10-07): precomputed high-intensity combined share (Z5+Z6+Z7).
    // Live failures kept surfacing cross-claim sums ("Z5-Z7 合计占 24%") — the
    // model has a systematic preference for aggregated summaries, and the
    // correct supply for that need is a deterministic calculated claim
    // (PD-AI-28 ③), not a relaxed number gate.
    const highIntensityZones = zones.filter((zone) => zone.key === "z5" || zone.key === "z6" || zone.key === "z7");
    const highIntensityDurationS = highIntensityZones.reduce((sum, zone) => sum + zone.durationS, 0);
    const highIntensityShare = highIntensityZones.reduce((sum, zone) => sum + zone.share, 0);
    if (highIntensityDurationS > 0) {
      claims.push(claim(rideId, "power.zone.highIntensityCombined", highIntensityDurationS, "s", refs, {
        kind: "advanced", quality: powerQuality === "valid" ? "valid" : "soft", formulaVersion: RIDE_POWER_ZONE_RULES_VERSION,
        supports: ["power_zone_distribution"], prohibits: ["training_effect"],
        displayValue: compact(highIntensityShare * 100, 0), displayUnit: "%",
      }));
    }
  } else capabilities.set("powerZones", unavailableCapability("powerZones", ["power", "verifiedFtp", "timing"],
    powerZoneDependency ?? "SOURCE_UNAVAILABLE"));

  const intensityDependency = missingDependency(capabilities, ["power", "normalizedPower", "verifiedFtp"]);
  if (!intensityDependency && finite(np) && ftpAvailable) {
    const value = np / profile!.ftp!.valueWatts;
    const evidenceId = derivedEvidence(rideId, "power-intensity-factor");
    const refs = [sourceRef(derivedSource, [evidenceId, derivedEvidence(rideId, "power-normalized-contiguous")]),
      sourceRef(profileSource, [derivedEvidence(rideId, `profile-ftp-${profile!.ftp!.updatedAt}`)])];
    const quality = npQuality === "valid" ? "valid" : "soft";
    capabilities.set("intensity", availableCapability("intensity", ["power", "normalizedPower", "verifiedFtp"], refs,
      quality, ["ride_intensity_factor"], ["recovery", "health_status", "training_effect"]));
    claims.push(claim(rideId, "power.intensityFactor", value, "ratio", refs, {
      kind: "advanced", quality, formulaVersion: RIDE_INTENSITY_RULES_VERSION, supports: ["ride_intensity_factor"],
      prohibits: ["recovery", "health_status", "training_effect"], displayValue: compact(value, 2), displayUnit: "ratio",
    }));
  } else capabilities.set("intensity", unavailableCapability("intensity", ["power", "normalizedPower", "verifiedFtp"],
    intensityDependency ?? "SOURCE_UNAVAILABLE"));

  const loadDependency = missingDependency(capabilities, ["power", "normalizedPower", "verifiedFtp", "timing"]);
  if (!loadDependency && finite(np) && ftpAvailable && power.eligibleWeight > 0) {
    const intensityFactor = np / profile!.ftp!.valueWatts;
    const value = (power.eligibleWeight * np * intensityFactor / (profile!.ftp!.valueWatts * 3_600)) * 100;
    const evidenceId = derivedEvidence(rideId, "power-training-stress");
    const refs = [sourceRef(derivedSource, [evidenceId, derivedEvidence(rideId, "power-normalized-contiguous")]),
      sourceRef(profileSource, [derivedEvidence(rideId, `profile-ftp-${profile!.ftp!.updatedAt}`)]), ...temporalRef];
    const quality = npQuality === "valid" ? "valid" : "soft";
    capabilities.set("trainingLoad", availableCapability("trainingLoad", ["power", "normalizedPower", "verifiedFtp", "timing"], refs,
      quality, ["single_ride_training_load"], ["recovery", "injury_risk", "training_effect"]));
    claims.push(claim(rideId, "power.trainingStressScore", value, "score", refs, {
      kind: "advanced", quality, formulaVersion: RIDE_INTENSITY_RULES_VERSION, supports: ["single_ride_training_load"],
      prohibits: ["recovery", "injury_risk", "training_effect"], displayValue: compact(value, 1), displayUnit: "score",
    }));
  } else capabilities.set("trainingLoad", unavailableCapability("trainingLoad", ["power", "normalizedPower", "verifiedFtp", "timing"],
    loadDependency ?? "SOURCE_UNAVAILABLE"));

  if (profile?.weightKg?.value && profile.weightKg.value > 0 && power.statistics) {
    const weightEvidence = derivedEvidence(rideId, `profile-weightKg-${profile.weightKg.updatedAt}`);
    const refs = [sourceRef(temporalSource, power.evidenceIds), sourceRef(profileSource, [weightEvidence])];
    claims.push(claim(rideId, "power.averageWkg", power.statistics.mean / profile.weightKg.value, "W/kg", refs, {
      kind: "advanced", quality: powerQuality === "valid" ? "valid" : "soft", formulaVersion: power.formulaVersion,
      supports: ["relative_power_output"], prohibits: ["ability_change"],
      displayValue: compact(power.statistics.mean / profile.weightKg.value, 2), displayUnit: "W/kg",
    }));
  }

  for (const key of ["historyComparison", "longTermLoad", "recoverySignals", "sameRouteComparison", "trend", "knowledgeEvidence"] as const) {
    capabilities.set(key, unavailableCapability(key, [], "RULE_NOT_IMPLEMENTED_IN_S2_01"));
  }

  // V21-07: KB-driven derived metric claims (design doc §4.2).
  const derivedMetrics = buildDerivedMetricClaimsV21({
    rideId,
    derivedSource,
    np,
    powerMean: power.statistics?.mean,
    hrMean: heartRate.statistics?.mean,
    powerSamples: powerSeconds.allValues,
    powerQuality,
    record,
  });
  claims.push(...derivedMetrics.claims);
  limitations.push(...derivedMetrics.limitations);

  const sources = [activitySource, seriesSource, temporalSource, windowsSource, profileSource, derivedSource,
    ...(routeShapeSource ? [routeShapeSource] : [])];
  return {
    schemaVersion: RIDE_CAPABILITY_CLAIMS_SCHEMA_VERSION,
    rulesVersion: RIDE_CAPABILITY_CLAIMS_RULES_VERSION,
    evidenceRulesVersion: RIDE_EVIDENCE_RULES_VERSION,
    rideId,
    sourceInventory: sources.map((item) => inventoryItem(rideId, item)),
    capabilities: evidenceCapabilityKeys.map((key) => capabilities.get(key)!),
    claims,
    limitations: unique(limitations),
  };
}

// V21-07: KB-driven derived metric claims (design doc §4.2). Derived metrics
// reuse the same deterministic sources as the rest of the snapshot; a missing
// dependency yields a limitation instead of a claim (never zero-filled). Shared
// metrics (VI/EF) are computed once here and referenced by their dimensions.
function buildDerivedMetricClaimsV21(params: {
  rideId: string;
  derivedSource: SourceSpec;
  np: number | undefined;
  powerMean: number | undefined;
  hrMean: number | undefined;
  powerSamples: number[];
  powerQuality: EvidenceQuality;
  record: RideRecord;
}): { claims: V2AnalysisClaim[]; limitations: string[] } {
  const claims: V2AnalysisClaim[] = [];
  const limitations: string[] = [];
  const { rideId, derivedSource, np, powerMean, hrMean, powerSamples, powerQuality, record } = params;
  const quality: V2AnalysisClaim["qualityStatus"] = powerQuality === "valid" ? "valid" : "soft";

  // VI（变速系数 = NP / 平均功率）。同时被配速执行与功率输出（有效功率比）引用。
  if (finite(np) && finite(powerMean) && powerMean > 0) {
    const vi = variabilityIndex(np, powerMean);
    if (vi !== undefined) {
      const refs = [sourceRef(derivedSource, [derivedEvidence(rideId, "pacing-vi")])];
      claims.push(claim(rideId, "pacing.variabilityIndex", vi, "ratio", refs, {
        kind: "advanced", quality, formulaVersion: RIDE_DERIVED_METRICS_V21_VERSION,
        supports: ["power_variability"], prohibits: ["causation", "ability_change"],
        displayValue: compact(vi, 2), displayUnit: "ratio",
      }));
    }
  } else {
    limitations.push("pacing.variabilityIndex:NP_OR_POWER_MISSING");
  }

  // 停歇时间占比 = 停歇 / 总时间。
  const timing = buildRideTimingSummary(record);
  if (finite(timing.stoppedTimeS) && finite(timing.elapsedTimeS) && timing.elapsedTimeS > 0) {
    const share = stoppedTimeSharePercent(timing.stoppedTimeS, timing.elapsedTimeS);
    if (share !== undefined) {
      const refs = [sourceRef(derivedSource, [derivedEvidence(rideId, "pacing-stopped-share")])];
      claims.push(claim(rideId, "pacing.stoppedTimeShare", share, "ratio", refs, {
        kind: "advanced", formulaVersion: timing.rulesVersion,
        supports: ["stop_observation"], prohibits: ["causation", "stop_cause"],
        displayValue: compact(share, 1), displayUnit: "%",
      }));
    }
  }

  // 功率曲线扩展：5s / 1min / 5min / 20min / 1h 最大滑动窗口平均功率。
  for (const durationS of [5, 60, 300, 1200, 3600] as const) {
    const best = bestAveragePower(powerSamples, durationS);
    if (best === undefined) continue; // 样本不足：不生成，也不伪造
    const refs = [sourceRef(derivedSource, [derivedEvidence(rideId, `power-curve-${durationS}s`)])];
    claims.push(claim(rideId, `power.curve.${durationS}s`, best, "W", refs, {
      kind: "advanced", quality, formulaVersion: RIDE_DERIVED_METRICS_V21_VERSION,
      supports: ["power_curve"], prohibits: ["causation", "ability_change"],
      displayValue: compact(best, 0), displayUnit: "W",
      // 时长标签进 text，数字门据此放行"5 秒/60 秒/300 秒"等窗口时长（否则
      // 时长的数字会被当成数据值拦截 NUMBER_NOT_IN_CLAIMS）。
      text: `${durationS}s 滑动窗口最大平均功率`,
    }));
  }

  // 前半/后半功率差 + 负分割（用前后半各自 NP，口径照知识库）。
  if (powerSamples.length >= 60) {
    const half = Math.floor(powerSamples.length / 2);
    const firstHalfNp = normalizedPower([powerSamples.slice(0, half)]);
    const secondHalfNp = normalizedPower([powerSamples.slice(half)]);
    if (finite(firstHalfNp) && finite(secondHalfNp)) {
      const differencePct = splitDifferencePercent(firstHalfNp, secondHalfNp);
      const split = negativeSplit(firstHalfNp, secondHalfNp);
      if (differencePct !== undefined) {
        const refs = [sourceRef(derivedSource, [derivedEvidence(rideId, "pacing-split-difference")])];
        claims.push(claim(rideId, "pacing.splitDifference", differencePct, "ratio", refs, {
          kind: "advanced", quality, formulaVersion: RIDE_DERIVED_METRICS_V21_VERSION,
          supports: ["pacing_split"], prohibits: ["causation", "ability_change", "training_plan_completion"],
          displayValue: compact(differencePct, 1), displayUnit: "%",
        }));
      }
      if (split !== undefined) {
        const refs = [sourceRef(derivedSource, [derivedEvidence(rideId, "pacing-negative-split")])];
        claims.push(claim(rideId, "pacing.negativeSplit", split.differencePct, "ratio", refs, {
          kind: "advanced", quality, formulaVersion: RIDE_DERIVED_METRICS_V21_VERSION,
          supports: [`pacing_${split.grade}`], prohibits: ["causation", "ability_change", "training_plan_completion"],
          displayValue: compact(split.differencePct, 1), displayUnit: "%",
          text: `negative split grade: ${split.grade}`,
        }));
      }
    }
  } else {
    limitations.push("pacing.splitDifference:INSUFFICIENT_POWER_SAMPLES");
  }

  // 效率因子 EF = NP / 平均心率。同时被心率负荷与跨传感器引用。
  if (finite(np) && finite(hrMean) && hrMean > 0) {
    const ef = efficiencyFactor(np, hrMean);
    if (ef !== undefined) {
      const refs = [sourceRef(derivedSource, [derivedEvidence(rideId, "heartRate-efficiency-factor")])];
      claims.push(claim(rideId, "heartRate.efficiencyFactor", ef, "W/bpm", refs, {
        kind: "advanced", quality, formulaVersion: RIDE_DERIVED_METRICS_V21_VERSION,
        supports: ["aerobic_efficiency"], prohibits: ["causation", "medical_diagnosis", "recovery"],
        displayValue: compact(ef, 2), displayUnit: "W/bpm",
      }));
    }
  } else {
    limitations.push("heartRate.efficiencyFactor:NP_OR_HR_MISSING");
  }

  return { claims, limitations };
}

export function getEvidenceCapabilityV2(
  snapshot: RideCapabilityClaimSnapshotV2,
  key: EvidenceCapabilityKey,
): V2EvidenceCapability {
  const capability = snapshot.capabilities.find((item) => item.key === key);
  if (!capability) throw new Error(`V2 capability is missing: ${key}`);
  return capability;
}

export function validateRideCapabilityClaimsV2(snapshot: RideCapabilityClaimSnapshotV2): CapabilityClaimIssue[] {
  const issues: CapabilityClaimIssue[] = [];
  const add = (code: string, path: string): void => { issues.push({ code, path }); };
  if (snapshot.schemaVersion !== RIDE_CAPABILITY_CLAIMS_SCHEMA_VERSION || snapshot.evidenceRulesVersion !== RIDE_EVIDENCE_RULES_VERSION) {
    add("VERSION_MISMATCH", "version");
  }
  const sources = new Map(snapshot.sourceInventory.map((item) => [item.sourceId, item]));
  const capabilities = new Map(snapshot.capabilities.map((item) => [item.key, item]));
  if (capabilities.size !== evidenceCapabilityKeys.length || evidenceCapabilityKeys.some((key) => !capabilities.has(key))) {
    add("CAPABILITY_SET_INCOMPLETE", "capabilities");
  }
  for (const capability of snapshot.capabilities) {
    const path = `capabilities.${capability.key}`;
    if (capability.status === "unavailable" && (!capability.unavailableReason || capability.qualityStatus !== "unavailable")) {
      add("UNAVAILABLE_CAPABILITY_INVALID", path);
    }
    if (capability.status !== "unavailable" && !capability.evidenceIds.length) add("CAPABILITY_EVIDENCE_MISSING", path);
    if (capability.status !== "unavailable") {
      for (const dependency of capability.dependencyKeys) {
        if (capabilities.get(dependency)?.status === "unavailable") add("CAPABILITY_DEPENDENCY_UNAVAILABLE", path);
      }
    }
    if (capability.evidenceIds.some((id) => !capability.sourceIds.some((sourceId) => sources.get(sourceId)?.evidenceIds.includes(id)))) {
      add("CAPABILITY_EVIDENCE_INVALID", path);
    }
  }
  const claimIds = new Set<string>();
  for (const item of snapshot.claims) {
    const path = `claims.${item.claimId}`;
    if (claimIds.has(item.claimId)) add("DUPLICATE_CLAIM", path);
    claimIds.add(item.claimId);
    if (item.rideId !== snapshot.rideId || !finite(item.value)) add("CLAIM_VALUE_INVALID", path);
    const referenced = item.sourceRefs.flatMap((ref) => {
      const matching = sources.get(ref.sourceId);
      if (!matching || matching.version !== ref.version || matching.status !== "available" || !matching.authorized) {
        add("CLAIM_SOURCE_INVALID", path);
      }
      if (ref.evidenceIds.some((id) => !matching?.evidenceIds.includes(id))) add("CLAIM_EVIDENCE_INVALID", path);
      return ref.evidenceIds;
    });
    if (unique(referenced).length !== item.evidenceIds.length || item.evidenceIds.some((id) => !referenced.includes(id))) {
      add("CLAIM_EVIDENCE_INDEX_MISMATCH", path);
    }
  }
  return issues;
}
