import type { V2AnalysisClaim, EvidenceSource, EvidenceSourceRef } from "./ride-analysis-evidence-v2.ts";

// RIDE-AI-PMC-01 (PRD FR-08 / business rules 15, user decision 2026-10-06):
// deterministic long-term load and recovery statistics based on the PMC model
// (performance management chart) from the frozen knowledge base (KB-01
// "体能-疲劳-状态模型" entry). Daily TSS is exponentially weighted with a
// 42-day time constant for CTL (chronic load) and a 7-day constant for ATL
// (acute load); TSB = CTL - ATL. TSB is a load-balance signal, never a
// physiological measurement — claims stay kind="history" and can only support
// signal-level conclusions. Recovery wording in model output is gated on a
// TSB claim with TSB >= +5 (ride-output-validator-v2).

export const RIDE_PMC_LOAD_SCHEMA_VERSION = "2.0.0" as const;
export const RIDE_PMC_LOAD_RULES_VERSION = "ride-pmc-load-v2.0" as const;

// PMC parameters (KB-01 frozen knowledge; TrainingPeaks convention).
export const RIDE_PMC_CTL_TIME_CONSTANT_DAYS = 42 as const;
export const RIDE_PMC_ATL_TIME_CONSTANT_DAYS = 7 as const;
// Recovery-wording gate: TSB must reach this value before "恢复良好" style
// conclusions may pass validation (user decision 2026-10-06).
export const RIDE_PMC_RECOVERY_TSB_THRESHOLD = 5 as const;
// Window gates: at least 42 calendar days and 10 load days with valid TSS.
export const RIDE_PMC_MIN_WINDOW_DAYS = 42 as const;
export const RIDE_PMC_MIN_LOAD_DAYS = 10 as const;

export interface RidePmcDailyLoadInput {
  historyId: string;
  // ISO calendar date "YYYY-MM-DD" of the ride day.
  date: string;
  // TSS of that ride; the caller guarantees it was computed with a confirmed
  // FTP (S2-01 gates) — this module only re-checks finiteness and sign.
  tss: number;
}

export type RidePmcLoadStatus =
  | "available"
  | "unavailable";

export interface RidePmcLoadSnapshotV2 {
  schemaVersion: typeof RIDE_PMC_LOAD_SCHEMA_VERSION;
  rulesVersion: typeof RIDE_PMC_LOAD_RULES_VERSION;
  status: RidePmcLoadStatus;
  reason?:
    | "FTP_NOT_CONFIRMED"
    | "NO_TSS_HISTORY"
    | "INSUFFICIENT_WINDOW"
    | "INSUFFICIENT_LOAD_DAYS"
    | "INVALID_INPUT";
  rideId: string;
  anchorDate: string;
  ctl?: number;
  atl?: number;
  tsb?: number;
  windowDays?: number;
  loadDays?: number;
  sourceHistoryIds: string[];
  evidenceIds: string[];
  // Full evidence source entry (available snapshots only) so downstream
  // snapshots can register it in their source inventory.
  source?: EvidenceSource;
  claims: V2AnalysisClaim[];
  limitations: string[];
}

export interface BuildRidePmcLoadV2Options {
  rideId: string;
  // ISO calendar date "YYYY-MM-DD" of the ride being analyzed (anchor day).
  anchorDate: string;
  // Whether the FTP used for the historical TSS values was user-confirmed.
  ftpConfirmed: boolean;
  dailyLoads: RidePmcDailyLoadInput[];
}

export interface RidePmcLoadIssue {
  code: string;
  path: string;
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string): number | undefined {
  if (!datePattern.test(value)) return undefined;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(time) ? undefined : time;
}

function dayNumber(time: number): number {
  return Math.floor(time / 86_400_000);
}

function formatDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function pmcSource(rideId: string, loads: RidePmcDailyLoadInput[], windowDays: number): EvidenceSource {
  return {
    sourceId: `source:${rideId}:history:pmc`,
    kind: "history",
    version: RIDE_PMC_LOAD_RULES_VERSION,
    status: "available",
    authorized: true,
    evidenceIds: loads.map((load) => `evidence:${load.historyId}:tss`),
    // The PMC window aggregates many historical rides; the source identity is
    // the window itself, not the ride under analysis (history sources must
    // not point at the current ride).
    rideId: `pmc-window:${rideId}`,
    coverage: `${windowDays}d`,
  };
}

function pmcClaim(
  rideId: string,
  source: EvidenceSource,
  key: "history.pmc.ctl" | "history.pmc.atl" | "history.pmc.tsb",
  value: number,
  text: string,
  supports: string[],
): V2AnalysisClaim {
  const sourceRef: EvidenceSourceRef = {
    sourceId: source.sourceId,
    version: source.version,
    evidenceIds: [...source.evidenceIds],
  };
  return {
    claimId: `claim:${rideId}:v2:${key}`,
    rideId,
    kind: "history",
    key,
    value,
    unit: key === "history.pmc.tsb" ? "TSS" : "TSS/day",
    text,
    confidence: "high",
    provenance: "calculated",
    qualityStatus: "valid",
    sourceRefs: [sourceRef],
    evidenceIds: [...source.evidenceIds],
    formulaVersion: RIDE_PMC_LOAD_RULES_VERSION,
    supports,
    prohibits: ["causation", "overtraining", "medical_diagnosis", "injury_prediction"],
  };
}

function unavailable(
  options: BuildRidePmcLoadV2Options,
  reason: NonNullable<RidePmcLoadSnapshotV2["reason"]>,
): RidePmcLoadSnapshotV2 {
  return {
    schemaVersion: RIDE_PMC_LOAD_SCHEMA_VERSION,
    rulesVersion: RIDE_PMC_LOAD_RULES_VERSION,
    status: "unavailable",
    reason,
    rideId: options.rideId,
    anchorDate: options.anchorDate,
    sourceHistoryIds: [],
    evidenceIds: [],
    claims: [],
    limitations: [`history.pmcLoad:${reason}`],
  };
}

export function buildRidePmcLoadV2(options: BuildRidePmcLoadV2Options): RidePmcLoadSnapshotV2 {
  const { rideId, anchorDate, ftpConfirmed, dailyLoads } = options;

  if (!rideId.trim() || !datePattern.test(anchorDate)) {
    return unavailable(options, "INVALID_INPUT");
  }
  for (const load of dailyLoads) {
    if (!load.historyId.trim() || !datePattern.test(load.date) || !Number.isFinite(load.tss) || load.tss <= 0) {
      return unavailable(options, "INVALID_INPUT");
    }
  }
  if (!ftpConfirmed) return unavailable(options, "FTP_NOT_CONFIRMED");
  if (dailyLoads.length === 0) return unavailable(options, "NO_TSS_HISTORY");

  const anchorTime = parseDate(anchorDate);
  if (anchorTime === undefined) return unavailable(options, "INVALID_INPUT");

  // Collapse multiple rides on one day (TSS adds up per TrainingPeaks convention).
  const tssByDay = new Map<number, number>();
  for (const load of dailyLoads) {
    const time = parseDate(load.date);
    if (time === undefined || dayNumber(time) > dayNumber(anchorTime)) {
      return unavailable(options, "INVALID_INPUT");
    }
    tssByDay.set(dayNumber(time), (tssByDay.get(dayNumber(time)) ?? 0) + load.tss);
  }

  const firstLoadDay = Math.min(...tssByDay.keys());
  const anchorDay = dayNumber(anchorTime);
  const windowDays = anchorDay - firstLoadDay + 1;
  if (windowDays < RIDE_PMC_MIN_WINDOW_DAYS) return unavailable(options, "INSUFFICIENT_WINDOW");
  if (tssByDay.size < RIDE_PMC_MIN_LOAD_DAYS) return unavailable(options, "INSUFFICIENT_LOAD_DAYS");

  // Exponential weighted iteration day by day; rest days contribute TSS=0.
  // Initialization: CTL and ATL both start at the first load day's TSS.
  const firstDayTss = tssByDay.get(firstLoadDay) as number;
  let ctl = firstDayTss;
  let atl = firstDayTss;
  for (let day = firstLoadDay + 1; day <= anchorDay; day += 1) {
    const tss = tssByDay.get(day) ?? 0;
    ctl += (tss - ctl) / RIDE_PMC_CTL_TIME_CONSTANT_DAYS;
    atl += (tss - atl) / RIDE_PMC_ATL_TIME_CONSTANT_DAYS;
  }
  const tsb = ctl - atl;

  const source = pmcSource(rideId, dailyLoads, windowDays);
  const rounded = (value: number): number => Math.round(value * 10) / 10;
  const claims: V2AnalysisClaim[] = [
    pmcClaim(
      rideId,
      source,
      "history.pmc.ctl",
      rounded(ctl),
      `Chronic training load (CTL) over a ${windowDays}-day window (${tssByDay.size} load days): ${rounded(ctl)} TSS/day`,
      ["long_term_load"],
    ),
    pmcClaim(
      rideId,
      source,
      "history.pmc.atl",
      rounded(atl),
      `Acute 7-day training load (ATL): ${rounded(atl)} TSS/day`,
      ["long_term_load"],
    ),
    pmcClaim(
      rideId,
      source,
      "history.pmc.tsb",
      rounded(tsb),
      `Training stress balance (TSB) on ${formatDate(anchorTime)}: ${rounded(tsb)} — a load-balance signal from the PMC model, not a physiological measurement`,
      ["long_term_load", "recovery_signal"],
    ),
  ];

  return {
    schemaVersion: RIDE_PMC_LOAD_SCHEMA_VERSION,
    rulesVersion: RIDE_PMC_LOAD_RULES_VERSION,
    status: "available",
    rideId,
    anchorDate,
    ctl: rounded(ctl),
    atl: rounded(atl),
    tsb: rounded(tsb),
    windowDays,
    loadDays: tssByDay.size,
    sourceHistoryIds: dailyLoads.map((load) => load.historyId),
    evidenceIds: [...source.evidenceIds],
    source,
    claims,
    limitations: [],
  };
}

export function validateRidePmcLoadV2(snapshot: RidePmcLoadSnapshotV2): RidePmcLoadIssue[] {
  const issues: RidePmcLoadIssue[] = [];
  const add = (code: string, path: string): void => {
    issues.push({ code, path });
  };
  if (snapshot.schemaVersion !== RIDE_PMC_LOAD_SCHEMA_VERSION || snapshot.rulesVersion !== RIDE_PMC_LOAD_RULES_VERSION) {
    add("VERSION_MISMATCH", "version");
  }
  if (!snapshot.rideId.trim() || !datePattern.test(snapshot.anchorDate)) add("INVALID_IDENTITY", "rideId/anchorDate");
  if (snapshot.status === "available") {
    const keys = new Set(snapshot.claims.map((claim) => claim.key));
    for (const key of ["history.pmc.ctl", "history.pmc.atl", "history.pmc.tsb"]) {
      if (!keys.has(key)) add("PMC_CLAIM_MISSING", key);
    }
    for (const claim of snapshot.claims) {
      if (claim.kind !== "history" || claim.rideId !== snapshot.rideId) add("PMC_CLAIM_INVALID", claim.claimId);
      if (claim.value === undefined || !Number.isFinite(claim.value)) add("PMC_CLAIM_VALUE_INVALID", claim.claimId);
    }
    if (
      typeof snapshot.ctl !== "number"
      || typeof snapshot.atl !== "number"
      || typeof snapshot.tsb !== "number"
      || Math.abs(snapshot.tsb - (snapshot.ctl - snapshot.atl)) > 0.15
      || (snapshot.windowDays ?? 0) < RIDE_PMC_MIN_WINDOW_DAYS
      || (snapshot.loadDays ?? 0) < RIDE_PMC_MIN_LOAD_DAYS
    ) {
      add("PMC_VALUES_INCONSISTENT", "ctl/atl/tsb/window");
    }
  } else if (!snapshot.reason) {
    add("REASON_MISSING", "reason");
  }
  return issues;
}
