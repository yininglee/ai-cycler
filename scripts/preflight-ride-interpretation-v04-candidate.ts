import { readFile } from "node:fs/promises";
import { RELATION_TYPES, validateRideInterpretationV04Candidate, type RideInterpretationV04Candidate } from "../src/ai/ride-interpretation-v04-candidate.ts";

const file = "eval/ride-interpretation-v0.4-candidate/fixtures.json";
const payload = JSON.parse(await readFile(file, "utf8")) as { schemaVersion: string; fixtures: Array<{ id: string; candidate: RideInterpretationV04Candidate }> };
if (payload.schemaVersion !== "ride-interpretation-candidate-fixtures-v0.1") throw new Error("INVALID_FIXTURE_SCHEMA");
for (const fixture of payload.fixtures) {
  const result = validateRideInterpretationV04Candidate(fixture.candidate);
  if (!result.valid) throw new Error(`${fixture.id}: ${result.issues.join(",")}`);
  console.log(`PASS ${fixture.id}`);
}
const relationTypes = new Set(payload.fixtures.flatMap((fixture) => fixture.candidate.claims)
  .filter((claim) => claim.claimType === "relation" || claim.claimType === "history")
  .map((claim) => claim.relation?.relationType));
for (const relationType of RELATION_TYPES) {
  if (!relationTypes.has(relationType)) throw new Error(`MISSING_RELATION_TYPE:${relationType}`);
}
console.log(`Ride interpretation candidate preflight passed: ${payload.fixtures.length} fixtures, no model calls.`);
