import assert from "node:assert/strict";
import test from "node:test";

import { runTargetedDiagnosticRepetitions } from "../src/ai/ride-interpretation-targeted-diagnostic.ts";

test("targeted diagnostic persists the first B0 as complete and does not invoke another slot", async () => {
  const providerInvocations: number[] = [];
  const persisted: Array<{ status: string; resultCount: number; stopReason?: string }> = [];

  const completed = await runTargetedDiagnosticRepetitions({
    repetitions: 3,
    runSlot: async (repetition) => {
      providerInvocations.push(repetition);
      return { slot: `F05:R${repetition}`, b0Fallback: true };
    },
    persist: async (progress) => {
      persisted.push({
        status: progress.status,
        resultCount: progress.results.length,
        stopReason: progress.stop?.reason,
      });
    },
  });

  assert.deepEqual(providerInvocations, [1]);
  assert.deepEqual(persisted, [
    { status: "running", resultCount: 1, stopReason: undefined },
    { status: "complete", resultCount: 1, stopReason: "FIRST_B0_FALLBACK" },
  ]);
  assert.equal(completed.stop?.stoppedAtSlot, "F05:R1");
});

test("targeted diagnostic completes all successful authorized repetitions", async () => {
  const providerInvocations: number[] = [];
  const completed = await runTargetedDiagnosticRepetitions({
    repetitions: 3,
    runSlot: async (repetition) => {
      providerInvocations.push(repetition);
      return { slot: `F09:R${repetition}`, b0Fallback: false };
    },
    persist: async () => undefined,
  });

  assert.deepEqual(providerInvocations, [1, 2, 3]);
  assert.equal(completed.status, "complete");
  assert.equal(completed.stop, undefined);
});
