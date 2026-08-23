import { mkdir, writeFile } from "node:fs/promises";

import { disabledRideAnalysisFewShots } from "../src/ai/ride-analysis-few-shot.ts";
import { prepareRideAnalysis } from "../src/ai/ride-analysis-service.ts";
import type { RideRecord } from "../src/domain/ride-schema.ts";
import { getRideFixture } from "../src/fixtures/rides.ts";
import { getRideAnalysisEvalFixture, type RideAnalysisEvalCaseId } from "../src/fixtures/ride-analysis-eval.ts";

const defaultFixtureIds = ["l1-built-in-sample", "l2-built-in-sample", "l3-built-in-sample"];
const fixtureIds = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultFixtureIds;
const outputDirectory = "output/coze-inputs";

await mkdir(outputDirectory, { recursive: true });

for (const fixtureId of fixtureIds) {
  let record: RideRecord;
  let contextOptions = {};
  let outputName = fixtureId;
  try {
    const fixture = getRideFixture(fixtureId);
    record = { activity: structuredClone(fixture.activity), series: structuredClone(fixture.series) };
  } catch {
    const evalFixture = getRideAnalysisEvalFixture(fixtureId as RideAnalysisEvalCaseId);
    record = evalFixture.record;
    contextOptions = evalFixture.contextOptions;
    outputName = evalFixture.fixtureId;
  }
  const prepared = prepareRideAnalysis(record, "local-demo", contextOptions);
  const input = {
    analysis_context: JSON.stringify(prepared.context),
    analysis_elig: JSON.stringify(prepared.eligibility),
    few_shot_json: JSON.stringify(disabledRideAnalysisFewShots()),
    repair_instruction: "",
    previous_output: "",
  };
  const file = `${outputDirectory}/${outputName}.json`;
  await writeFile(file, `${JSON.stringify(input, null, 2)}\n`, "utf8");
  console.log(`已生成 ${file}`);
}
