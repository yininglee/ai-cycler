export type TargetedDiagnosticStopReason = "FIRST_B0_FALLBACK";

export type TargetedDiagnosticProgress<Result extends { b0Fallback: boolean; slot: string }> = {
  status: "running" | "complete";
  results: readonly Result[];
  stop?: {
    reason: TargetedDiagnosticStopReason;
    stoppedAtSlot: string;
  };
};

/**
 * A diagnostic samples independent slots only while each completed slot is
 * healthy. A B0 is conclusive for the authorized diagnostic budget.
 */
export async function runTargetedDiagnosticRepetitions<Result extends { b0Fallback: boolean; slot: string }>(options: {
  repetitions: number;
  runSlot: (repetition: number) => Promise<Result>;
  persist: (progress: TargetedDiagnosticProgress<Result>) => Promise<void>;
}): Promise<TargetedDiagnosticProgress<Result>> {
  const results: Result[] = [];
  for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
    const result = await options.runSlot(repetition);
    results.push(result);
    await options.persist({ status: "running", results });
    if (result.b0Fallback) {
      const complete: TargetedDiagnosticProgress<Result> = {
        status: "complete",
        results,
        stop: { reason: "FIRST_B0_FALLBACK", stoppedAtSlot: result.slot },
      };
      await options.persist(complete);
      return complete;
    }
  }

  const complete: TargetedDiagnosticProgress<Result> = { status: "complete", results };
  await options.persist(complete);
  return complete;
}
