import type { AnalysisEligibility } from "../domain/analysis-eligibility.ts";
import type { AnalysisContextClaim, RideAnalysisContext } from "../domain/ride-analysis-context.ts";
import {
  INTERPRETATION_DIMENSION_IDS,
  RIDE_INTERPRETATION_V04_CANDIDATE_VERSION,
  validateRideInterpretationV04Candidate,
  type CandidateAvailability,
  type CandidateClaim,
  type CandidateLimitation,
  type CandidateVisualRef,
  type CandidateVisualType,
  type InterpretationDimensionId,
  type RideInterpretationV04Candidate,
} from "./ride-interpretation-v04-candidate.ts";

export const RIDE_INTERPRETATION_PLAN_VERSION = "ride-interpretation-plan-v0.1" as const;

export interface RideInterpretationPlan {
  planVersion: typeof RIDE_INTERPRETATION_PLAN_VERSION;
  mode: "default" | "expanded";
  focusDimensionIds: InterpretationDimensionId[];
  eligibleDimensionIds: InterpretationDimensionId[];
  priorityScores: Partial<Record<InterpretationDimensionId, number>>;
  exclusions: Array<{ dimensionId: InterpretationDimensionId; reason: string }>;
  candidate?: RideInterpretationV04Candidate;
}

interface DimensionDefinition {
  id: Exclude<InterpretationDimensionId, "history_change">;
  legacyDimensions: string[];
  metricKeys: string[];
  factFeaturePrefixes?: string[];
  featurePrefixes: string[];
  visualSupportFeaturePrefixes?: string[];
  advancedPrefixes: string[];
  visualId: string;
  visualType: CandidateVisualType;
  priority: number;
}

const DIMENSIONS: DimensionDefinition[] = [
  {
    id: "route_pacing",
    legacyDimensions: ["pace"],
    metricKeys: ["avgSpeedMps", "movingTimeS", "elapsedTimeS", "distanceM"],
    featurePrefixes: ["speed"],
    advancedPrefixes: ["timing.", "cruise."],
    visualId: "visual:series:speed",
    visualType: "trend",
    priority: 60,
  },
  {
    id: "terrain_climb",
    legacyDimensions: ["climbing"],
    metricKeys: ["elevationGainM"],
    featurePrefixes: ["elevation"],
    advancedPrefixes: ["route.", "elevation.", "climb."],
    visualId: "visual:series:elevation",
    visualType: "trend",
    priority: 55,
  },
  {
    id: "heart_rate",
    legacyDimensions: ["heartRate"],
    metricKeys: ["avgHeartRateBpm", "maxHeartRateBpm"],
    featurePrefixes: ["heartRate"],
    advancedPrefixes: ["heartRate."],
    visualId: "visual:series:heart_rate",
    visualType: "zone_distribution",
    priority: 70,
  },
  {
    id: "power_output",
    legacyDimensions: ["power"],
    metricKeys: ["avgPowerW", "normalizedPowerW", "maxPowerW"],
    featurePrefixes: ["power", "normalizedPower"],
    advancedPrefixes: ["power."],
    visualId: "visual:series:power",
    visualType: "trend",
    priority: 80,
  },
  {
    id: "cadence",
    legacyDimensions: ["cadence"],
    metricKeys: ["avgCadenceRpm", "maxCadenceRpm"],
    featurePrefixes: ["cadence"],
    advancedPrefixes: ["cadence."],
    visualId: "visual:series:cadence",
    visualType: "zone_distribution",
    priority: 45,
  },
  {
    id: "pacing_stability",
    legacyDimensions: ["pace"],
    metricKeys: [],
    factFeaturePrefixes: ["speedCoefficientOfVariation", "speedStdDev"],
    featurePrefixes: ["speedStdDev", "speedCoefficientOfVariation", "speedFirstLastDelta"],
    visualSupportFeaturePrefixes: ["speedSeriesMean"],
    advancedPrefixes: ["cruise."],
    visualId: "visual:series:speed",
    visualType: "trend",
    priority: 50,
  },
];

function matchesPrefix(claim: AnalysisContextClaim, prefixes: string[]): boolean {
  return prefixes.some((prefix) => claim.key.startsWith(prefix));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function candidateClaim(
  dimensionId: InterpretationDimensionId,
  claimType: CandidateClaim["claimType"],
  source: AnalysisContextClaim | AnalysisContextClaim[],
  availability: Exclude<CandidateAvailability, "hidden">,
): CandidateClaim {
  return {
    claimId: `candidate:${dimensionId}:${claimType}`,
    dimensionId,
    claimType,
    sourceClaimIds: unique((Array.isArray(source) ? source : [source]).map((claim) => claim.claimId)),
    availability,
  };
}

function claimSources(claims: CandidateClaim[]): string[] {
  return unique(claims.flatMap((claim) => claim.sourceClaimIds));
}

function availabilityFor(context: RideAnalysisContext, dimensionId: InterpretationDimensionId): Exclude<CandidateAvailability, "hidden"> {
  if (dimensionId === "power_output" && context.limitations.some((limitation) => limitation.startsWith("advanced.power:soft_quality"))) return "partial";
  if (dimensionId === "terrain_climb" && context.limitations.some((limitation) => limitation.startsWith("advanced.route:partial_coverage"))) return "partial";
  return "available";
}

function limitationSource(
  context: RideAnalysisContext,
  definition: DimensionDefinition,
  fallback: AnalysisContextClaim,
): AnalysisContextClaim {
  if (definition.id === "power_output") {
    return context.allowedClaims.find((claim) => claim.kind === "advanced" && claim.key === "power.quality") ?? fallback;
  }
  return context.allowedClaims.find((claim) => claim.kind === "advanced" && claim.key.startsWith("route.")) ?? fallback;
}

function canOpen(definition: DimensionDefinition, eligibility: AnalysisEligibility): boolean {
  return definition.legacyDimensions.some((dimension) => eligibility.allowedDimensionKeys.includes(dimension as never));
}

export function buildRideInterpretationPlan(
  context: RideAnalysisContext,
  eligibility: AnalysisEligibility,
  mode: "default" | "expanded" = "default",
): RideInterpretationPlan {
  const exclusions: RideInterpretationPlan["exclusions"] = [{ dimensionId: "history_change", reason: "persistent_history_deferred" }];
  const claims: CandidateClaim[] = [];
  const visualRegistry: CandidateVisualRef[] = [];
  const limitations: CandidateLimitation[] = [];
  const dimensionAvailability = Object.fromEntries(INTERPRETATION_DIMENSION_IDS.map((id) => [id, "hidden"])) as Record<InterpretationDimensionId, CandidateAvailability>;
  const eligibleDimensionIds: InterpretationDimensionId[] = [];
  const priorityScores: RideInterpretationPlan["priorityScores"] = {};

  for (const definition of DIMENSIONS) {
    if (!eligibility.eligible || !canOpen(definition, eligibility)) {
      exclusions.push({ dimensionId: definition.id, reason: "eligibility_not_open" });
      continue;
    }

    const fact = context.allowedClaims.find((claim) => claim.kind === "metric" && definition.metricKeys.includes(claim.key))
      ?? context.allowedClaims.find((claim) => claim.kind === "feature" && matchesPrefix(claim, definition.factFeaturePrefixes ?? []));
    const performance = context.allowedClaims.find((claim) => claim.kind === "feature" && matchesPrefix(claim, definition.featurePrefixes))
      ?? context.allowedClaims.find((claim) => claim.kind === "advanced" && matchesPrefix(claim, definition.advancedPrefixes));
    if (!fact || !performance) {
      exclusions.push({ dimensionId: definition.id, reason: "fact_or_performance_missing" });
      continue;
    }

    const availability = availabilityFor(context, definition.id);
    dimensionAvailability[definition.id] = availability;
    eligibleDimensionIds.push(definition.id);
    priorityScores[definition.id] = definition.priority + (availability === "available" ? 10 : 0);

    const visualSupport = context.allowedClaims.find((claim) => claim.kind === "feature" && matchesPrefix(claim, definition.visualSupportFeaturePrefixes ?? []));
    const factCandidate = candidateClaim(definition.id, "fact", fact, availability);
    const performanceSources = visualSupport ? [performance, visualSupport] : performance;
    const performanceCandidate = candidateClaim(definition.id, "performance", performanceSources, availability);
    const capabilityCandidate = candidateClaim(definition.id, "capability_evidence", performanceSources, availability);
    claims.push(factCandidate, performanceCandidate, capabilityCandidate);
    const visualSources = claimSources([factCandidate, performanceCandidate]);
    const existingVisual = visualRegistry.find((visual) => visual.visualId === definition.visualId);
    if (existingVisual) {
      const sharedSources = existingVisual.sourceClaimIds.filter((claimId) => visualSources.includes(claimId));
      if (sharedSources.length === 0) {
        throw new Error(`Shared visual ${definition.visualId} has no common deterministic evidence`);
      }
      existingVisual.sourceClaimIds = sharedSources;
      if (availability === "partial") existingVisual.availability = "partial";
    } else {
      visualRegistry.push({
        visualId: definition.visualId,
        type: definition.visualType,
        sourceClaimIds: visualSources,
        availability,
        ruleVersion: "ride-visual-rules-v0.1",
      });
    }

    if (availability === "partial") {
      const limitation = candidateClaim(definition.id, "limitation", limitationSource(context, definition, performance), availability);
      claims.push(limitation);
      limitations.push({ dimensionId: definition.id, claimIds: [limitation.claimId] });
    }
  }

  const ranked = [...eligibleDimensionIds].sort((left, right) => (priorityScores[right] ?? 0) - (priorityScores[left] ?? 0));
  const focusDimensionIds = mode === "default" ? ranked.slice(0, 3) : ranked;
  if (focusDimensionIds.length === 0) {
    return {
      planVersion: RIDE_INTERPRETATION_PLAN_VERSION,
      mode,
      focusDimensionIds,
      eligibleDimensionIds,
      priorityScores,
      exclusions,
    };
  }

  const unitFor = (dimensionId: InterpretationDimensionId) => ({
    dimensionId,
    factClaimIds: [`candidate:${dimensionId}:fact`],
    performanceClaimIds: [`candidate:${dimensionId}:performance`],
    capabilityEvidenceClaimIds: [`candidate:${dimensionId}:capability_evidence`],
    meaningClaimIds: [`candidate:${dimensionId}:fact`, `candidate:${dimensionId}:performance`],
    visualRefIds: [DIMENSIONS.find((definition) => definition.id === dimensionId)!.visualId],
  });
  const { dimensionId: _overallDimensionId, ...overallAssessment } = unitFor(focusDimensionIds[0]!);
  const candidate: RideInterpretationV04Candidate = {
    contractVersion: RIDE_INTERPRETATION_V04_CANDIDATE_VERSION,
    mode,
    // Expanded output is ordered by this same deterministic ranking. Keeping
    // the registry and planned units aligned makes the candidate reproducible.
    eligibleDimensionIds: ranked,
    dimensionAvailability,
    sourceClaimIds: context.allowedClaims.map((claim) => claim.claimId),
    claims,
    visualRegistry,
    overallAssessment,
    dimensionInterpretations: focusDimensionIds.map(unitFor),
    limitations,
  };
  const validation = validateRideInterpretationV04Candidate(candidate);
  if (!validation.valid) throw new Error(`Ride interpretation plan is invalid: ${validation.issues.join(",")}`);

  return {
    planVersion: RIDE_INTERPRETATION_PLAN_VERSION,
    mode,
    focusDimensionIds,
    eligibleDimensionIds: ranked,
    priorityScores,
    exclusions,
    candidate,
  };
}
