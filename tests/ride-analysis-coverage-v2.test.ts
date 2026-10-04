import assert from "node:assert/strict";
import test from "node:test";
import { coverageRoutes, fieldCoverage } from "../src/domain/ride-analysis-coverage-v2.ts";
import { analysisDimensionIds, evidenceCapabilityKeys } from "../src/domain/ride-analysis-evidence-v2.ts";

test("V2 source catalog lists all 15 normalized metrics and every deterministic result", () => {
  assert.equal(Object.keys(fieldCoverage.metrics).length, 15);
  for (const group of ["timing", "elevationSummary", "routeShape", "climbSummary", "climb", "zone", "powerSummary"] as const) {
    assert.ok(Object.keys(fieldCoverage[group]).length > 0, group);
  }
  assert.equal(fieldCoverage.metrics.elevationLossM, "elevation");
  assert.equal(fieldCoverage.climbSummary.climbs, "climb");
  assert.equal(fieldCoverage.powerSummary.unavailableReasons, "powerQuality");
});

test("every registered field has a valid downstream route or an explicit exclusion", () => {
  const referenced = new Set<string>();
  for (const [group, fields] of Object.entries(fieldCoverage)) {
    for (const [field, key] of Object.entries(fields)) {
      referenced.add(key);
      const route = coverageRoutes[key as keyof typeof coverageRoutes];
      assert.ok(route, `${group}.${field} has no route`);
      for (const capability of route.capabilities) assert.ok(evidenceCapabilityKeys.includes(capability), `${group}.${field} has unknown capability`);
      for (const packet of route.packets) assert.ok(analysisDimensionIds.includes(packet), `${group}.${field} has unknown packet`);
      if (route.disposition === "fact") {
        assert.notEqual(route.claim, "none", `${group}.${field} is silently dropped`);
        assert.ok(route.packets.length, `${group}.${field} has no destination packet`);
      } else if (route.disposition === "inventory" || route.disposition === "private") {
        assert.equal(route.claim, "none", `${group}.${field} must not claim performance`);
        assert.ok(route.reason, `${group}.${field} needs an exclusion reason`);
      } else {
        assert.equal(route.claim, "limitation", `${group}.${field} must constrain conclusions`);
      }
    }
  }
  assert.deepEqual([...referenced].sort(), Object.keys(coverageRoutes).sort(), "unreferenced route requires review");
  assert.equal(coverageRoutes[fieldCoverage.source.fileName].disposition, "private");
  assert.equal(coverageRoutes[fieldCoverage.sourceIssue.message].disposition, "private");
  assert.equal(coverageRoutes[fieldCoverage.point.route].feature, "relative route signature, never raw coordinates");
  assert.ok(coverageRoutes[fieldCoverage.powerSummary.intensityFactor].capabilities.includes("verifiedFtp"));
  assert.ok(coverageRoutes[fieldCoverage.powerSummary.trainingStressScore].capabilities.includes("timing"));
  assert.ok(!coverageRoutes[fieldCoverage.powerSummary.averagePowerW].capabilities.map(String).includes("verifiedFtp"));
  assert.equal(coverageRoutes[fieldCoverage.derived.jointSensorWindow].claim, "relation");
});
