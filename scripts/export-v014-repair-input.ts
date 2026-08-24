import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  type RideAnalysisInvocation,
  type RideAnalysisProvider,
} from "../src/ai/coze-workflow-client.ts";
import { prepareRideAnalysis, runRideAnalysis } from "../src/ai/ride-analysis-service.ts";
import type { RideAnalysisOutputV03 } from "../src/ai/ride-analysis-output-v03.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";

interface ArchivedRun {
  raw_output: RideAnalysisOutputV03;
}

class CaptureRepairProvider implements RideAnalysisProvider {
  readonly calls: RideAnalysisInvocation[] = [];
  private readonly firstOutput: string;

  constructor(firstOutput: string) {
    this.firstOutput = firstOutput;
  }

  async run(input: RideAnalysisInvocation): Promise<{ rawText: string; providerRequestId: string }> {
    this.calls.push(input);
    return {
      rawText: this.calls.length === 1 ? this.firstOutput : "not-json",
      providerRequestId: `v014-repair-input-${this.calls.length}`,
    };
  }
}

const fixture = getRideFixture("l3-built-in-sample");
const prepared = prepareRideAnalysis(
  { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) },
  "local-demo",
);
const archivedRun = JSON.parse(
  await readFile("eval/runs/RUN-20260824-023.json", "utf8"),
) as ArchivedRun;
const previousOutput = structuredClone(archivedRun.raw_output);
previousOutput.overallAssessment.text += "本次骑行达到999W。";
previousOutput.overallAssessment.claimIds.push("claim:other-ride:avgPowerW");

const provider = new CaptureRepairProvider(JSON.stringify(previousOutput));
await runRideAnalysis(prepared, {
  enabled: true,
  provider,
  modelId: "input-export-only",
  requestId: "v014-repair-input",
});

const repairCall = provider.calls[1];
if (!repairCall?.repairInstruction || repairCall.previousOutput === undefined) {
  throw new Error("Service did not produce the expected constrained-repair invocation");
}

const output = {
  analysis_context: JSON.stringify(repairCall.analysisContext),
  analysis_elig: JSON.stringify(repairCall.eligibility),
  few_shot_json: JSON.stringify(repairCall.fewShotSelection),
  repair_instruction: repairCall.repairInstruction,
  previous_output: repairCall.previousOutput,
};
const outputDirectory = "output/coze-inputs";
const outputFile = `${outputDirectory}/l3-built-in-sample-repair-v3.1.2.json`;
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`已生成 ${outputFile}`);
