/**
 * V2.1-F (V21-13/14) 语义豁免层：把词级正则易"语义误拦截"的门，改为
 * 「正则预筛 + 大模型语义豁免」的第二道复核。
 *
 * 设计（设计文档 §10.4）：词级正则硬门照旧产出 issue（保证零回归 + 反例集
 * 长期有效）；本模块作为编排层新增的异步复核阶段，只对「可语义豁免」的错误码
 * （STABILITY_WITHOUT_VARIANCE / CAUSALITY_UPGRADED / SOFT_QUALITY_NOT_DISCLOSED）
 * 调大模型复核，判定为"误判"则撤销该 issue。**只豁免、不新增拦截**——这是
 * 零回归的关键：不注入语义校验器时，行为与现状完全一致。
 *
 * 纯函数（prompt 构建 / verdict 解析 / 断言上下文提取）可独立单测；
 * 大模型调用由调用方注入 `SemanticExemptionChecker`。
 */
import type { RideModelInputV2 } from "../domain/ride-model-input-v2.ts";
import type { RideOutputIssueV2 } from "./ride-output-validator-v2.ts";

export type SemanticExemptionGate = "stability" | "causality" | "softDisclosure";

// 可语义豁免的错误码 → 门类型。只豁免这三类；其余错误码（数字/维度/结构）
// 是确定性集合运算，永不进语义复核。
export const SEMANTIC_EXEMPT_CODES: Readonly<Record<string, SemanticExemptionGate>> = {
  STABILITY_WITHOUT_VARIANCE: "stability",
  CAUSALITY_UPGRADED: "causality",
  SOFT_QUALITY_NOT_DISCLOSED: "softDisclosure",
};

export const SEMANTIC_EXEMPT_PROMPT_VERSION = "ride-semantic-exemption-v2.0.0" as const;

export interface SemanticExemptionRequest {
  gate: SemanticExemptionGate;
  text: string;
  conclusionType: string;
  claimKeys: string[];
}

export interface SemanticExemptionVerdict {
  exempt: boolean;
  reason: string;
}

export type SemanticExemptionChecker = (request: SemanticExemptionRequest) => Promise<SemanticExemptionVerdict>;

const GATE_RULES: Record<SemanticExemptionGate, string> = {
  stability:
    `判断断言文本中的「稳定/平稳」属于哪种情况：违规（exempt=false）= 对本次骑行表现的稳定性断言（如「输出稳定」「节奏平稳」「功率保持稳定」），需要波动/过程类数据支撑；不违规（exempt=true）= 踏频/功率区间的名称或区间分布描述（如「稳定踏频占 37%」「稳定区间」「稳定区」「稳定和耐力区间」）。`,
  causality:
    `判断断言文本中的「导致/造成/引发」属于哪种情况：违规（exempt=false）= 越权的因果结论，断言本次骑行某事导致了某事；不违规（exempt=true）= 转述运动科学机制的客观知识说明（如「脱水导致血容量下降」这类生理学原理，非本次骑行的因果断言）。`,
  softDisclosure:
    `判断该维度文本是否已经披露了「部分数据缺失/有限」的含义：合规（exempt=true）= 文本已表达数据有限/缺失/采集不全/无法分析等含义（措辞可不同于「部分/缺失/有限」）；违规（exempt=false）= 文本未披露任何数据有限/缺失的含义。`,
};

export function buildSemanticExemptionPrompt(request: SemanticExemptionRequest): string {
  return [
    `你是「AI 骑行伙伴」骑后解读的语义校验器。判断一条断言是否真的违反了一条规则。`,
    "",
    `【规则】${GATE_RULES[request.gate]}`,
    "",
    `【断言】结论类型=${request.conclusionType || "（未知）"}；引用的证据键=[${request.claimKeys.join(", ") || "无"}]`,
    `文本：${request.text}`,
    "",
    `只输出一个 JSON 对象：{"exempt": true|false, "reason": "一句话理由"}`,
    "其中 exempt=true 表示该断言不违规（应放行），exempt=false 表示确实违规（应拦截）。",
  ].join("\n");
}

export function parseSemanticExemptionVerdict(rawText: string): SemanticExemptionVerdict | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        parsed = JSON.parse(fenced[1]);
      } catch {
        return undefined;
      }
    } else {
      return undefined;
    }
  }
  if (parsed && typeof parsed === "object" && "exempt" in parsed) {
    const value = parsed as { exempt?: unknown; reason?: unknown };
    return {
      exempt: value.exempt === true,
      reason: typeof value.reason === "string" ? value.reason : "",
    };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAt(value: unknown, path: string): unknown {
  const segments = path.match(/[^[.\]]+/g) ?? [];
  let current = value;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (typeof current === "object") current = (current as Record<string, unknown>)[segment];
    else return undefined;
  }
  return current;
}

// 从 issue.path 定位断言并提取语义复核所需的上下文（text / conclusionType /
// 引用的 claim keys）。处理三种 path 形态：断言对象（dimensions[4].assertions[1]）、
// .text 字符串（*.assertions[1].text）、断言数组（dimensions[0].assertions，
// SOFT_QUALITY_NOT_DISCLOSED 的 path 指向维度级，合并该维度所有断言文本）。
export function extractAssertionContext(
  output: unknown,
  path: string,
  input: RideModelInputV2,
): { text: string; conclusionType: string; claimKeys: string[] } | undefined {
  const claimKeyById = new Map(input.claims.map((claim) => [claim.claimId, claim.key]));
  const claimKeysOf = (claimIds: unknown): string[] => {
    if (!Array.isArray(claimIds)) return [];
    return claimIds.map((id) => claimKeyById.get(id)).filter((key): key is string => Boolean(key));
  };

  let target = getAt(output, path);
  if (typeof target === "string" && path.endsWith(".text")) {
    target = getAt(output, path.slice(0, -".text".length));
  }

  if (Array.isArray(target)) {
    const texts: string[] = [];
    const keys: string[] = [];
    for (const item of target) {
      if (isRecord(item)) {
        if (typeof item.text === "string") texts.push(item.text);
        keys.push(...claimKeysOf(item.claimIds));
      }
    }
    if (texts.length === 0) return undefined;
    return { text: texts.join(" "), conclusionType: "", claimKeys: [...new Set(keys)] };
  }

  if (isRecord(target)) {
    const text = typeof target.text === "string" ? target.text : undefined;
    if (text === undefined) return undefined;
    return {
      text,
      conclusionType: typeof target.conclusionType === "string" ? target.conclusionType : "",
      claimKeys: claimKeysOf(target.claimIds),
    };
  }
  return undefined;
}

// 对 issues 做语义豁免复核：只撤销"语义校验器判定为误判"的可豁免 issue。
// 语义校验器失败/不可用时保守处理（不撤销，维持正则硬门拦截）。只豁免、不新增。
export async function applySemanticExemption(
  input: RideModelInputV2,
  output: unknown,
  issues: RideOutputIssueV2[],
  checker: SemanticExemptionChecker | undefined,
): Promise<RideOutputIssueV2[]> {
  if (!checker || issues.length === 0) return issues;
  const exemptable = issues.filter((issue) => SEMANTIC_EXEMPT_CODES[issue.code] !== undefined);
  if (exemptable.length === 0) return issues;

  const exempted = new Set<string>();
  for (const issue of exemptable) {
    const gate = SEMANTIC_EXEMPT_CODES[issue.code]!;
    const context = extractAssertionContext(output, issue.path, input);
    if (!context) continue;
    try {
      const verdict = await checker({
        gate,
        text: context.text,
        conclusionType: context.conclusionType,
        claimKeys: context.claimKeys,
      });
      if (verdict.exempt) exempted.add(`${issue.code}@${issue.path}`);
    } catch {
      // 语义校验器异常：保守保留该 issue（fail-closed，宁可不豁免也不误放行）。
    }
  }
  if (exempted.size === 0) return issues;
  return issues.filter((issue) => !exempted.has(`${issue.code}@${issue.path}`));
}
