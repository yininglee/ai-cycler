import { readSiliconFlowChatProviderConfig, SiliconFlowChatProvider } from "../chat/siliconflow-chat-provider.ts";
import { trainingKnowledgeForPlan } from "../domain/training-knowledge-base.ts";
import { parsePlanProposal, PlanError, planWeekCount, type PlanProposal, type PlanRuleIssue, type TrainingPlan } from "../domain/training-plan.ts";
import { TRAINING_PLAN_GENERATION_PROMPT } from "./plan-generation-prompt.ts";
import type { planRuntime } from "./plan-service.ts";

type PlanRuntime = Awaited<ReturnType<typeof planRuntime>>;

function parseCandidate(rawText: string, knowledge: ReturnType<typeof trainingKnowledgeForPlan>): PlanProposal {
  let proposal: PlanProposal;
  try {
    const value = JSON.parse(rawText);
    if (!value || typeof value !== "object" || Object.keys(value).sort().join() !== "knowledgeIds,proposal") throw new Error();
    const ids: unknown = value.knowledgeIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3 || new Set(ids).size !== ids.length) throw new Error();
    const titles = ids.map(id => knowledge.find(entry => entry.knowledgeId === id)?.title);
    if (titles.some(title => title === undefined)) throw new Error();
    const candidate = parsePlanProposal(value.proposal);
    proposal = parsePlanProposal({ ...candidate, rationale: `${candidate.rationale.trim()} 知识依据：${titles.map(title => `《${title}》`).join("、")}。` });
  } catch {
    throw new PlanError("RULES_REJECTED", [{ code: "INVALID_PROPOSAL", message: "提案或知识引用格式无效。按输出合同返回周阶段、制定依据和本轮提供的知识 ID。" }]);
  }
  if (/\d/.test(proposal.rationale)) {
    throw new PlanError("RULES_REJECTED", [{ code: "INVALID_RATIONALE", message: "制定依据只能使用定性描述。去掉所有阿拉伯数字，保留目标、个人训练基础和所选课型的关系。" }]);
  }
  return proposal;
}

export async function generateTrainingPlanDraft(service: PlanRuntime, intakeVersion: number): Promise<TrainingPlan> {
  const { workspace, basis, constraints, missing, draft } = await service.context();
  if (workspace.intakeVersion !== intakeVersion) throw new PlanError("VERSION_CONFLICT");
  if (workspace.confirmedIntakeVersion !== intakeVersion) throw new PlanError("INTAKE_NOT_CONFIRMED");
  if (missing.length) throw new PlanError("MISSING_INTAKE");
  if (workspace.intake.healthConcern !== false) throw new PlanError("TRAINING_CONCERN");
  if (draft?.intakeVersion === intakeVersion) return draft;

  const { intake } = workspace;
  const knowledge = trainingKnowledgeForPlan(intake.goal, intake.powerMeter === true && basis.ftpWatts !== null);
  const { profileHash: _profileHash, ...trainingBasis } = basis;
  const evidence = {
    intake, basis: trainingBasis, constraints, weekCount: planWeekCount(intake),
    ...service.generationEvidence(),
    knowledge: knowledge.map(({ knowledgeId, title, explanation, limitations, conclusionStrength }) => ({ knowledgeId, title, explanation, limitations, conclusionStrength })),
  };

  const config = readSiliconFlowChatProviderConfig();
  if (!config) throw new PlanError("PLAN_GENERATION_UNAVAILABLE");
  const model = new SiliconFlowChatProvider(config);
  let repair: { issues: PlanRuleIssue[]; previousOutput: string } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let rawText: string;
    try {
      ({ rawText } = await model.completeJson(crypto.randomUUID(), TRAINING_PLAN_GENERATION_PROMPT, JSON.stringify({ ...evidence, ...repair })));
    } catch {
      throw new PlanError("PLAN_GENERATION_UNAVAILABLE");
    }
    try {
      const proposal = parseCandidate(rawText, knowledge);
      // Same version checks, calendar expansion, domain rules and transaction as propose_training_plan.
      return await service.propose({ intakeVersion, baseVersion: workspace.version, proposal });
    } catch (error) {
      if (!(error instanceof PlanError) || error.code !== "RULES_REJECTED" || attempt === 1) throw error;
      repair = { issues: error.issues.slice(0, 12), previousOutput: rawText.slice(0, 8_192) };
    }
  }
  throw new PlanError("RULES_REJECTED");
}
