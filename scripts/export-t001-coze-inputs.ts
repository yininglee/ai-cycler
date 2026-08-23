import { mkdir, writeFile } from "node:fs/promises";

import { disabledRideAnalysisFewShots } from "../src/ai/ride-analysis-few-shot.ts";
import { prepareRideAnalysis } from "../src/ai/ride-analysis-service.ts";
import { validateAnalysisEligibility } from "../src/domain/analysis-eligibility.ts";
import { validateRideAnalysisContext } from "../src/domain/ride-analysis-context.ts";
import {
  getT001AutomaticRideAnalysisCase,
  t001AutomaticRideAnalysisCaseIds,
} from "../src/fixtures/ride-analysis-t001.ts";

const outputDirectory = "output/coze-inputs";
await mkdir(outputDirectory, { recursive: true });

for (const caseId of t001AutomaticRideAnalysisCaseIds) {
  const item = getT001AutomaticRideAnalysisCase(caseId);
  const prepared = prepareRideAnalysis(item.record, `coze-t001:${caseId}`, item.contextOptions);
  const contextValidation = validateRideAnalysisContext(prepared.context);
  const eligibilityValidation = validateAnalysisEligibility(prepared.eligibility);
  if (!contextValidation.valid || !eligibilityValidation.valid) {
    throw new Error(`${caseId} contract invalid: ${JSON.stringify({ contextValidation, eligibilityValidation })}`);
  }
  const input = {
    analysis_context: JSON.stringify(prepared.context),
    analysis_elig: JSON.stringify(prepared.eligibility),
    few_shot_json: JSON.stringify(disabledRideAnalysisFewShots()),
    repair_instruction: "",
    previous_output: "",
  };
  const file = `${outputDirectory}/t001-${caseId}.json`;
  await writeFile(file, `${JSON.stringify(input, null, 2)}\n`, "utf8");
  console.log(`已生成 ${file}`);
}
