import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { ServerEnvironment } from "../src/ai/coze-workflow-client.ts";
import { projectRideInterpretationInputV04Candidate } from "../src/ai/ride-interpretation-input-v04-candidate.ts";
import { buildRideInterpretationPlan } from "../src/ai/ride-interpretation-plan.ts";
import { buildAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { buildRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

const ROOT = process.cwd();

function loadEnvLocal(): ServerEnvironment {
  const values: Record<string, string> = {};
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const raw = match[2] ?? "";
    values[match[1]] = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
      ? raw.slice(1, -1)
      : raw;
  }
  return { ...values, ...process.env };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

const environment = loadEnvLocal();
const workflowId = environment.COZE_INTERPRETATION_WORKFLOW_ID?.trim() || "7680762018618359814";
const workflowVersion = environment.COZE_INTERPRETATION_WORKFLOW_VERSION?.trim() || "v0.0.8";
const apiUrl = environment.COZE_API_URL?.trim();
const apiToken = environment.COZE_API_TOKEN?.trim();
if (!apiUrl || !apiToken) throw new Error("COZE_INTERPRETATION_ENV_INCOMPLETE");

const repetitions = Math.max(1, Math.min(5, Number(environment.AEVAL_PROVIDER_DIAG_REPETITIONS ?? "3") || 3));
const fixtureIds = process.argv.slice(2).filter((value) => ["l1-built-in-sample", "l2-built-in-sample"].includes(value));
const selectedFixtureIds = fixtureIds.length > 0 ? fixtureIds : ["l1-built-in-sample", "l2-built-in-sample"];

function classify(httpStatus: number, envelope: Record<string, unknown> | undefined, responseJson: boolean, hasCandidateOutput: boolean): string {
  if (httpStatus < 200 || httpStatus >= 300) return "HTTP_ERROR";
  if (!responseJson) return "INVALID_JSON";
  if (typeof envelope?.code === "number" && envelope.code !== 0) return "BUSINESS_REJECTED";
  if (!hasCandidateOutput) return "OUTPUT_MISSING";
  return "SUCCESS";
}

function hasCandidateOutput(value: unknown): boolean {
  if (typeof value === "string") {
    try { return hasCandidateOutput(JSON.parse(value)); } catch { return false; }
  }
  const record = asRecord(value);
  if (!record) return false;
  if (typeof record.schemaVersion === "string" && asRecord(record.oneLineLabel) && asRecord(record.overallAssessment)) return true;
  return ["interpretation_json", "interpretationJson", "analysis_json", "analysisJson", "output", "data"].some((key) => hasCandidateOutput(record[key]));
}

function candidateShape(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try { return candidateShape(JSON.parse(value)); } catch { return undefined; }
  }
  const record = asRecord(value);
  if (!record) return undefined;
  if (typeof record.schemaVersion === "string" && asRecord(record.oneLineLabel) && asRecord(record.overallAssessment)) {
    const dimensions = Array.isArray(record.dimensions) ? record.dimensions : undefined;
    const highlights = Array.isArray(record.highlights) ? record.highlights : undefined;
    return {
      rootKeys: Object.keys(record).sort(),
      dimensionCount: dimensions?.length ?? null,
      dimensionIds: dimensions?.map((item) => asRecord(item)?.dimensionId ?? null) ?? null,
      highlightCount: highlights?.length ?? null,
      highlightTargets: highlights?.map((item) => {
        const target = asRecord(item)?.target;
        if (typeof target === "string") return { type: "string", valueLength: target.length };
        if (Array.isArray(target)) return { type: "array", length: target.length };
        const targetRecord = asRecord(target);
        if (targetRecord) return { type: "object", keys: Object.keys(targetRecord).sort(), kind: targetRecord.kind ?? null };
        return { type: target === null ? "null" : typeof target };
      }) ?? null,
      limitationsType: Array.isArray(record.limitations) ? "array" : typeof record.limitations,
      limitationItems: Array.isArray(record.limitations) ? record.limitations.map((item) => {
        if (typeof item === "string") return { type: "string", valueLength: item.length };
        const itemRecord = asRecord(item);
        if (itemRecord) return { type: "object", keys: Object.keys(itemRecord).sort(), dimensionId: itemRecord.dimensionId ?? null, claimIdsType: Array.isArray(itemRecord.claimIds) ? "array" : typeof itemRecord.claimIds };
        return { type: item === null ? "null" : typeof item };
      }) : null,
      nextActionType: record.nextAction === null ? "null" : typeof record.nextAction,
    };
  }
  for (const key of ["interpretation_json", "interpretationJson", "analysis_json", "analysisJson", "output", "data"]) {
    const nested = candidateShape(record[key]);
    if (nested) return nested;
  }
  return undefined;
}

const results: Array<Record<string, unknown>> = [];
for (const fixtureId of selectedFixtureIds) {
  const fixture = getRideFixture(fixtureId);
  const context = buildRideAnalysisContext({ activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) });
  const input = projectRideInterpretationInputV04Candidate(context, buildRideInterpretationPlan(context, buildAnalysisEligibility(context)));
  if (!input) throw new Error(`CANDIDATE_INPUT_UNAVAILABLE:${fixtureId}`);
  const serializedInput = JSON.stringify(input);
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const requestId = `AEVAL-DIAG-${fixtureId}-${repetition}-${randomUUID().slice(0, 8)}`;
    const startedAt = Date.now();
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": requestId,
        },
        body: JSON.stringify({
          workflow_id: workflowId,
          workflow_version: workflowVersion,
          is_async: false,
          parameters: { ride_interp_input: serializedInput, repair_instruction: "", previous_output: "" },
        }),
        cache: "no-store",
      });
      const rawText = await response.text();
      const responseBytes = Buffer.byteLength(rawText, "utf8");
      let envelope: Record<string, unknown> | undefined;
      try { envelope = asRecord(JSON.parse(rawText)); } catch { /* shape only */ }
      const detail = asRecord(envelope?.detail);
      const candidateValue = envelope?.data ?? envelope;
      results.push({ fixtureId, repetition, requestId, workflowId, workflowVersion, httpStatus: response.status, businessCode: typeof envelope?.code === "number" ? envelope.code : null, responseJson: Boolean(envelope), responseBytes, inputBytes: Buffer.byteLength(serializedInput, "utf8"), hasCandidateOutput: hasCandidateOutput(candidateValue), category: classify(response.status, envelope, Boolean(envelope), hasCandidateOutput(candidateValue)), ...(candidateShape(candidateValue) ? { candidateShape: candidateShape(candidateValue) } : {}), logId: typeof detail?.logid === "string" ? detail.logid : null, latencyMs: Date.now() - startedAt });
    } catch (error) {
      results.push({ fixtureId, repetition, requestId, workflowId, workflowVersion, category: "NETWORK_ERROR", errorName: error instanceof Error ? error.name : "UnknownError", latencyMs: Date.now() - startedAt });
    }
  }
}

console.log(JSON.stringify({ workflowId, workflowVersion, repetitions, fixtures: selectedFixtureIds, results }, null, 2));
