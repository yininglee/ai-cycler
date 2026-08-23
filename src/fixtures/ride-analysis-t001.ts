import type { BuildRideAnalysisContextOptions } from "../domain/ride-analysis-context.ts";
import type { RideRecord } from "../domain/ride-schema.ts";
import { getRideFixture } from "./rides.ts";
import { getRideAnalysisEvalFixture } from "./ride-analysis-eval.ts";

export const t001AutomaticRideAnalysisCaseIds = [
  "RA-AUTO-001", "RA-AUTO-002", "RA-AUTO-003", "RA-AUTO-004", "RA-AUTO-005",
  "RA-AUTO-006", "RA-AUTO-007", "RA-AUTO-008", "RA-AUTO-009", "RA-AUTO-010",
  "RA-AUTO-011", "RA-AUTO-012", "RA-AUTO-013", "RA-AUTO-014", "RA-AUTO-015",
  "RA-AUTO-016", "RA-AUTO-017", "RA-AUTO-018",
] as const;

export type T001AutomaticRideAnalysisCaseId = typeof t001AutomaticRideAnalysisCaseIds[number];

export interface T001AutomaticRideAnalysisCase {
  caseId: T001AutomaticRideAnalysisCaseId;
  fixtureId: string;
  record: RideRecord;
  contextOptions: Omit<BuildRideAnalysisContextOptions, "userScope">;
}

function recordFromFixture(fixtureId: string): { fixtureId: string; record: RideRecord } {
  const fixture = getRideFixture(fixtureId);
  return {
    fixtureId,
    record: {
      activity: structuredClone(fixture.activity),
      series: structuredClone(fixture.series),
    },
  };
}

export function getT001AutomaticRideAnalysisCase(
  caseId: T001AutomaticRideAnalysisCaseId,
): T001AutomaticRideAnalysisCase {
  switch (caseId) {
    case "RA-AUTO-001":
    case "RA-AUTO-002": return { caseId, ...recordFromFixture("l1-built-in-sample"), contextOptions: {} };
    case "RA-AUTO-003": return { caseId, ...recordFromFixture("gpx-no-timestamps"), contextOptions: {} };
    case "RA-AUTO-004": return { caseId, ...recordFromFixture("l1-gps-spike"), contextOptions: {} };
    case "RA-AUTO-006": return { caseId, ...recordFromFixture("l2-built-in-sample"), contextOptions: {} };
    case "RA-AUTO-008": return { caseId, ...recordFromFixture("fit-heart-rate-dropout"), contextOptions: {} };
    case "RA-AUTO-011": return { caseId, ...recordFromFixture("l3-built-in-sample"), contextOptions: {} };
    case "RA-AUTO-014": return { caseId, ...recordFromFixture("fit-power-dropout-with-heart-rate"), contextOptions: {} };
    case "RA-AUTO-016":
    case "RA-AUTO-017": return { caseId, ...recordFromFixture("short-fit-ride"), contextOptions: {} };
    case "RA-AUTO-018": return { caseId, ...recordFromFixture("inconsistent-fit-summary"), contextOptions: {} };
    case "RA-AUTO-005":
    case "RA-AUTO-007":
    case "RA-AUTO-009":
    case "RA-AUTO-010":
    case "RA-AUTO-012":
    case "RA-AUTO-013":
    case "RA-AUTO-015": {
      const supplemental = getRideAnalysisEvalFixture(caseId);
      return {
        caseId,
        fixtureId: supplemental.fixtureId,
        record: supplemental.record,
        contextOptions: supplemental.contextOptions,
      };
    }
  }
}
