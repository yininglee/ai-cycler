import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  RELATION_TYPES,
  validateRideInterpretationV04Candidate,
  type RideInterpretationV04Candidate,
} from "../src/ai/ride-interpretation-v04-candidate.ts";

const fixtureFile = new URL("./fixtures/ride-interpretation-v04-candidate.json", import.meta.url);
const fixtures = JSON.parse(readFileSync(fixtureFile, "utf8")) as { fixtures: Array<{ id: string; candidate: RideInterpretationV04Candidate }> };

test("candidate interpretation fixtures pass the offline contract", () => {
  for (const fixture of fixtures.fixtures) {
    const result = validateRideInterpretationV04Candidate(fixture.candidate);
    assert.equal(result.valid, true, `${fixture.id}: ${result.issues.join(",")}`);
  }
});

test("candidate contract rejects a rendered hidden dimension", () => {
  const fixture = structuredClone(fixtures.fixtures[0]!.candidate);
  fixture.dimensionInterpretations.push({
    dimensionId: "heart_rate",
    factClaimIds: ["candidate:pace-fact"],
    performanceClaimIds: ["candidate:pace-performance"],
    capabilityEvidenceClaimIds: [],
    meaningClaimIds: ["candidate:pace-performance"],
    visualRefIds: [],
  });
  const result = validateRideInterpretationV04Candidate(fixture);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("DIMENSION_NOT_ELIGIBLE"));
  assert.ok(result.issues.includes("HIDDEN_DIMENSION_RENDERED"));
});

test("candidate contract rejects a relation without quality or window prerequisites", () => {
  const fixture = structuredClone(fixtures.fixtures[0]!.candidate);
  const relation = fixture.claims.find((claim) => claim.claimType === "relation")!;
  relation.relation!.minimumWindowPass = false;
  const result = validateRideInterpretationV04Candidate(fixture);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("RELATION_PRECONDITION_FAILED"));
});

test("candidate fixtures cover every relation type and reject failed relation preconditions", () => {
  const relationClaims = fixtures.fixtures.flatMap((fixture) => fixture.candidate.claims
    .filter((claim) => claim.claimType === "relation" || claim.claimType === "history")
    .map((claim) => ({ fixture, claim })));
  assert.deepEqual(
    new Set(relationClaims.map(({ claim }) => claim.relation?.relationType)),
    new Set(RELATION_TYPES),
  );

  for (const relationType of RELATION_TYPES) {
    const source = relationClaims.find(({ claim }) => claim.relation?.relationType === relationType)!;
    const fixture = structuredClone(source.fixture.candidate);
    const relation = fixture.claims.find((claim) => claim.claimId === source.claim.claimId)!.relation!;
    relation.qualityPass = false;
    const qualityResult = validateRideInterpretationV04Candidate(fixture);
    assert.ok(qualityResult.issues.includes("RELATION_PRECONDITION_FAILED"), relationType);

    const conflictFixture = structuredClone(source.fixture.candidate);
    const conflictRelation = conflictFixture.claims.find((claim) => claim.claimId === source.claim.claimId)!.relation!;
    conflictRelation.directionConsistent = false;
    const conflictResult = validateRideInterpretationV04Candidate(conflictFixture);
    assert.ok(conflictResult.issues.includes("RELATION_PRECONDITION_FAILED"), `${relationType}: conflict`);
  }
});

test("history relation rejects missing sides and non-comparable history", () => {
  const fixture = structuredClone(fixtures.fixtures[1]!.candidate);
  const history = fixture.claims.find((claim) => claim.claimType === "history")!;
  history.relation!.leftSourceClaimIds = [];
  const missingSideResult = validateRideInterpretationV04Candidate(fixture);
  assert.ok(missingSideResult.issues.includes("RELATION_MISSING_SIDE"));

  const nonComparableFixture = structuredClone(fixtures.fixtures[1]!.candidate);
  const nonComparableHistory = nonComparableFixture.claims.find((claim) => claim.claimType === "history")!;
  nonComparableHistory.history!.comparable = false;
  const nonComparableResult = validateRideInterpretationV04Candidate(nonComparableFixture);
  assert.ok(nonComparableResult.issues.includes("HISTORY_NOT_COMPARABLE"));
});

test("candidate contract rejects a visual referencing an unregistered source Claim", () => {
  const fixture = structuredClone(fixtures.fixtures[0]!.candidate);
  fixture.visualRegistry[0]!.sourceClaimIds = ["claim:ride:unknown"];
  const result = validateRideInterpretationV04Candidate(fixture);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("INVALID_VISUAL_REGISTRY_ENTRY"));
});
