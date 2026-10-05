import {
  analysisDimensionIds,
  RIDE_EVIDENCE_RULES_VERSION,
  validateRideAnalysisEvidenceV2,
  type AnalysisDimensionId,
  type EvidenceSource,
  type RideAnalysisEvidenceV2,
  type V2EvidenceCapability,
  type V2EvidencePacket,
  type V2KnowledgeEvidence,
} from "./ride-analysis-evidence-v2.ts";

export const RIDE_KNOWLEDGE_BASE_SCHEMA_VERSION = "2.0.0" as const;
export const RIDE_KNOWLEDGE_SELECTION_RULES_VERSION = "ride-knowledge-selection-v2.1" as const;

// V2 business rules 11.1: knowledge is an independent evidence layer with three source
// categories; it explains "how to usually interpret" and never acts as personal ride fact.
export type KnowledgeCategory = "cyclingSportsScience" | "cyclingDataStandard" | "sportsScience";
export type KnowledgeSourceType = "standard" | "guideline" | "review" | "textbook";
export type KnowledgeConclusionStrength = "high" | "moderate" | "limited";

// V2 business rules 11.2: every knowledge entry records identity, source, version,
// applicability, strength, limitations, safety boundaries, and the ride-fact keys it
// must never replace.
export interface KnowledgeBaseEntryV2 {
  knowledgeId: string;
  category: KnowledgeCategory;
  topic: string;
  title: string;
  publisher: string;
  sourceType: KnowledgeSourceType;
  version: string;
  citationLocation: string;
  applicableDimensions: AnalysisDimensionId[];
  applicableConditions: string[];
  conclusionStrength: KnowledgeConclusionStrength;
  limitations: string[];
  safetyBoundaries: string[];
  forbiddenFactKeys: string[];
  explanation: string;
}

export interface KnowledgeBaseIssue {
  code: string;
  path: string;
}

export interface AttachRideKnowledgeEvidenceV2Options {
  knowledgeBase: KnowledgeBaseEntryV2[];
  knowledgeBaseVersion: string;
  retrievedAt: string;
}

const knowledgeCategories = ["cyclingSportsScience", "cyclingDataStandard", "sportsScience"] as const;
const knowledgeSourceTypes = ["standard", "guideline", "review", "textbook"] as const;
const knowledgeStrengths = ["high", "moderate", "limited"] as const;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function validateRideKnowledgeBaseV2(entries: KnowledgeBaseEntryV2[]): KnowledgeBaseIssue[] {
  const issues: KnowledgeBaseIssue[] = [];
  const add = (code: string, path: string): void => { issues.push({ code, path }); };
  const seen = new Set<string>();
  for (const entry of entries) {
    const path = `knowledgeBase.${entry.knowledgeId || "<blank>"}`;
    if (!entry.knowledgeId.trim()) add("KNOWLEDGE_ID_MISSING", path);
    if (seen.has(entry.knowledgeId)) add("DUPLICATE_KNOWLEDGE_ID", path);
    seen.add(entry.knowledgeId);
    if (!entry.topic.trim() || !entry.title.trim() || !entry.publisher.trim()
      || !entry.version.trim() || !entry.citationLocation.trim() || !entry.explanation.trim()) {
      add("KNOWLEDGE_FIELDS_INVALID", path);
    }
    if (!knowledgeCategories.includes(entry.category)) add("KNOWLEDGE_CATEGORY_INVALID", path);
    if (!knowledgeSourceTypes.includes(entry.sourceType)) add("KNOWLEDGE_SOURCE_TYPE_INVALID", path);
    if (!knowledgeStrengths.includes(entry.conclusionStrength)) add("KNOWLEDGE_STRENGTH_INVALID", path);
    if (!entry.applicableDimensions.length
      || entry.applicableDimensions.some((dimension) => !analysisDimensionIds.includes(dimension))) {
      add("KNOWLEDGE_DIMENSION_INVALID", path);
    }
    if (!entry.applicableConditions.length) add("KNOWLEDGE_CONDITIONS_MISSING", path);
    if (!entry.limitations.length) add("KNOWLEDGE_LIMITATIONS_MISSING", path);
    if (!entry.forbiddenFactKeys.length) add("KNOWLEDGE_FORBIDDEN_FACT_KEYS_MISSING", path);
  }
  return issues;
}

function knowledgeSource(entry: KnowledgeBaseEntryV2): EvidenceSource {
  return {
    sourceId: `knowledge:${entry.knowledgeId}`,
    kind: "knowledge",
    version: entry.version,
    status: "available",
    authorized: true,
    evidenceIds: [entry.knowledgeId],
    coverage: entry.category,
  };
}

function knowledgeEvidence(
  entry: KnowledgeBaseEntryV2,
  coveredDimensions: AnalysisDimensionId[],
  options: AttachRideKnowledgeEvidenceV2Options,
): V2KnowledgeEvidence {
  return {
    knowledgeId: entry.knowledgeId,
    sourceRef: {
      sourceId: `knowledge:${entry.knowledgeId}`,
      version: entry.version,
      evidenceIds: [entry.knowledgeId],
    },
    citation: `${entry.title} — ${entry.publisher} (${entry.version}), ${entry.citationLocation}`,
    explanation: entry.explanation,
    applicableDimensions: [...coveredDimensions],
    conditions: unique([
      ...entry.applicableConditions,
      ...entry.safetyBoundaries,
      `strength:${entry.conclusionStrength}`,
    ]),
    retrievedAt: options.retrievedAt,
    knowledgeBaseVersion: options.knowledgeBaseVersion,
    conclusionStrength: entry.conclusionStrength,
    limitations: [...entry.limitations],
    safetyBoundaries: [...entry.safetyBoundaries],
    forbiddenFactKeys: [...entry.forbiddenFactKeys],
  };
}

function knowledgeCapability(selected: V2KnowledgeEvidence[]): V2EvidenceCapability {
  if (selected.length) {
    return {
      key: "knowledgeEvidence",
      status: "available",
      qualityStatus: "valid",
      dependencyKeys: [],
      sourceIds: selected.map((item) => item.sourceRef.sourceId),
      evidenceIds: selected.map((item) => item.knowledgeId),
      rulesVersion: RIDE_EVIDENCE_RULES_VERSION,
      supports: ["knowledge_explanation", "recommendation_context"],
      prohibits: ["ride_fact_generation", "profile_or_history_substitution", "medical_diagnosis", "causation", "fabricated_citation"],
    };
  }
  return {
    key: "knowledgeEvidence",
    status: "unavailable",
    qualityStatus: "unavailable",
    dependencyKeys: [],
    sourceIds: [],
    evidenceIds: [],
    rulesVersion: RIDE_EVIDENCE_RULES_VERSION,
    supports: [],
    prohibits: ["ride_fact_generation", "profile_or_history_substitution", "medical_diagnosis", "causation", "fabricated_citation"],
    unavailableReason: "NO_APPLICABLE_KNOWLEDGE",
  };
}

// Attaches applicable knowledge evidence to an existing S2-02 packet context. Knowledge is
// only selected for dimensions that already have a qualified packet: it never opens an
// unavailable dimension, never adds or rewrites ride Claims, and when nothing applies it
// leaves the context free of citations instead of fabricating a source.
export function attachRideKnowledgeEvidenceV2(
  context: RideAnalysisEvidenceV2,
  options: AttachRideKnowledgeEvidenceV2Options,
): RideAnalysisEvidenceV2 {
  const baseIssues = validateRideKnowledgeBaseV2(options.knowledgeBase);
  if (baseIssues.length) {
    throw new Error(`S3-02 knowledge base is invalid: ${baseIssues.map((issue) => issue.code).join(",")}`);
  }
  if (!options.knowledgeBaseVersion.trim() || !options.retrievedAt.trim()) {
    throw new Error("S3-02 requires knowledgeBaseVersion and retrievedAt");
  }

  const packetDimensions = new Set(context.evidencePackets.map((packet) => packet.dimensionId));
  const selected: V2KnowledgeEvidence[] = [];
  const sources: EvidenceSource[] = [];
  for (const entry of options.knowledgeBase) {
    const coveredDimensions = entry.applicableDimensions
      .filter((dimension) => packetDimensions.has(dimension));
    if (!coveredDimensions.length) continue;
    sources.push(knowledgeSource(entry));
    selected.push(knowledgeEvidence(entry, coveredDimensions, options));
  }
  const knowledgeByDimension = new Map<AnalysisDimensionId, string[]>(
    analysisDimensionIds.map((dimension) => [dimension, [] as string[]]),
  );
  for (const item of selected) {
    for (const dimension of item.applicableDimensions) {
      knowledgeByDimension.get(dimension)!.push(item.knowledgeId);
    }
  }

  const evidencePackets: V2EvidencePacket[] = context.evidencePackets.map((packet) => ({
    ...packet,
    knowledgeIds: unique(knowledgeByDimension.get(packet.dimensionId) ?? []),
  }));
  const attached: RideAnalysisEvidenceV2 = {
    ...context,
    sourceInventory: [
      ...context.sourceInventory.map((source) => ({ ...source, evidenceIds: [...source.evidenceIds] })),
      ...sources,
    ],
    capabilities: context.capabilities.map((capability) => (
      capability.key === "knowledgeEvidence"
        ? knowledgeCapability(selected)
        : { ...capability, dependencyKeys: [...capability.dependencyKeys], sourceIds: [...capability.sourceIds], evidenceIds: [...capability.evidenceIds], supports: [...capability.supports], prohibits: [...capability.prohibits] }
    )),
    knowledgeEvidence: selected,
    evidencePackets,
  };
  const issues = validateRideAnalysisEvidenceV2(attached);
  if (issues.length) {
    throw new Error(`S3-02 knowledge context is invalid: ${issues.map((issue) => issue.code).join(",")}`);
  }
  return attached;
}
