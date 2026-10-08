import test from "node:test";
import assert from "node:assert/strict";

import {
  SEMANTIC_EXEMPT_CODES,
  buildSemanticExemptionPrompt,
  parseSemanticExemptionVerdict,
  extractAssertionContext,
  applySemanticExemption,
  type SemanticExemptionChecker,
  type SemanticExemptionVerdict,
} from "../src/ai/ride-semantic-exemption-v2.ts";
import type { RideModelInputV2 } from "../src/domain/ride-model-input-v2.ts";
import type { RideOutputIssueV2 } from "../src/ai/ride-output-validator-v2.ts";

function makeInput(claims: Array<{ claimId: string; key: string }>): RideModelInputV2 {
  return { claims } as unknown as RideModelInputV2;
}

function issue(code: string, path: string): RideOutputIssueV2 {
  return { code, path, message: "test" } as unknown as RideOutputIssueV2;
}

test("SEMANTIC_EXEMPT_CODES maps only the three exemptable codes", () => {
  assert.equal(SEMANTIC_EXEMPT_CODES["STABILITY_WITHOUT_VARIANCE"], "stability");
  assert.equal(SEMANTIC_EXEMPT_CODES["CAUSALITY_UPGRADED"], "causality");
  assert.equal(SEMANTIC_EXEMPT_CODES["SOFT_QUALITY_NOT_DISCLOSED"], "softDisclosure");
  assert.equal(SEMANTIC_EXEMPT_CODES["NUMBER_NOT_IN_CLAIMS"], undefined);
  assert.equal(SEMANTIC_EXEMPT_CODES["CLAIM_NOT_IN_DIMENSION"], undefined);
});

test("buildSemanticExemptionPrompt embeds gate rule, text and keys", () => {
  const prompt = buildSemanticExemptionPrompt({
    gate: "stability",
    text: "稳定踏频占 37%",
    conclusionType: "fact",
    claimKeys: ["cadence.zone.steady"],
  });
  assert.ok(prompt.includes("稳定"));
  assert.ok(prompt.includes("稳定踏频占 37%"));
  assert.ok(prompt.includes("cadence.zone.steady"));
  assert.ok(prompt.includes("exempt"));
});

test("parseSemanticExemptionVerdict parses plain and fenced JSON", () => {
  assert.deepEqual(parseSemanticExemptionVerdict('{"exempt":true,"reason":"zone name"}'), {
    exempt: true,
    reason: "zone name",
  });
  assert.deepEqual(parseSemanticExemptionVerdict('```json\n{"exempt":false,"reason":"assertion"}\n```'), {
    exempt: false,
    reason: "assertion",
  });
  assert.equal(parseSemanticExemptionVerdict("not json at all"), undefined);
});

test("extractAssertionContext resolves object / array / .text paths", () => {
  const input = makeInput([{ claimId: "c1", key: "cadence.zone.steady" }]);
  const output = {
    dimensions: [
      {
        dimensionId: "cadenceStrategy",
        assertions: [
          { text: "稳定踏频占 37%", conclusionType: "fact", claimIds: ["c1"] },
          { text: "踏频稳定", conclusionType: "interpretation", claimIds: ["c1"] },
        ],
      },
    ],
  };
  assert.equal(extractAssertionContext(output, "dimensions[0].assertions[0]", input)?.text, "稳定踏频占 37%");
  assert.equal(extractAssertionContext(output, "dimensions[0].assertions[1].text", input)?.text, "踏频稳定");

  const ctx = extractAssertionContext(output, "dimensions[0].assertions", input);
  assert.ok(ctx?.text.includes("稳定踏频占 37%"));
  assert.deepEqual(ctx?.claimKeys, ["cadence.zone.steady"]);
});

test("applySemanticExemption revokes exempted issues, keeps violations, fail-closed", async () => {
  const input = makeInput([{ claimId: "c1", key: "cadence.zone.steady" }]);
  const output = {
    dimensions: [{ assertions: [{ text: "稳定踏频占 37%", conclusionType: "fact", claimIds: ["c1"] }] }],
  };
  const issues: RideOutputIssueV2[] = [
    issue("STABILITY_WITHOUT_VARIANCE", "dimensions[0].assertions[0]"),
    issue("NUMBER_NOT_IN_CLAIMS", "dimensions[0].assertions[0].text"),
  ];

  // No checker -> unchanged (zero regression path).
  assert.equal((await applySemanticExemption(input, output, issues, undefined)).length, 2);

  // Checker exempts stability only; deterministic NUMBER_NOT_IN_CLAIMS untouched.
  const checker: SemanticExemptionChecker = async (req) =>
    req.gate === "stability" ? { exempt: true, reason: "zone name" } : { exempt: false, reason: "real number" };
  const result = await applySemanticExemption(input, output, issues, checker);
  assert.deepEqual(result.map((item) => item.code), ["NUMBER_NOT_IN_CLAIMS"]);

  // Checker throws -> fail-closed keeps the issue.
  const throwing: SemanticExemptionChecker = async () => {
    throw new Error("boom");
  };
  assert.equal((await applySemanticExemption(input, output, issues, throwing)).length, 2);

  // Checker says not-exempt -> issue stays.
  const keepAll: SemanticExemptionChecker = async (): Promise<SemanticExemptionVerdict> => ({
    exempt: false,
    reason: "real assertion",
  });
  assert.equal((await applySemanticExemption(input, output, issues, keepAll)).length, 2);
});
