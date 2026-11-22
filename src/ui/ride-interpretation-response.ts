export function hasInterpretationIdentity(value: unknown, rideId: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return response.rideId === rideId && ["v2", "b0", "safety_stop"].includes(String(response.source));
}
export function interpretationFailureMessage(code?: string): string {
  switch (code) {
    case "AI_DISABLED": return "当前未启用深度解读服务，可以先查看这条骑行的事实与图表。";
    case "AI_NOT_CONFIGURED": return "深度解读服务尚未配置，可以先查看这条骑行的事实与图表。";
    case "DATA_NOT_ELIGIBLE": return "这条记录的可用证据不足以生成可靠解读，先查看已有事实与图表。";
    case "AI_TIMEOUT": return "解读服务响应超时，骑行记录已保留，可以重试。";
    case "PROVIDER_RATE_LIMITED": return "解读服务繁忙，请稍后重试，骑行记录已保留。";
    case "REPAIR_FAILED": return "生成结果未通过可靠性校验，本次暂不展示，可以重试。";
    default: return "本次解读暂时不可用，骑行记录已保留，可以稍后重试。";
  }
}

/** Presentation only: keep the original evidence codes in the validated output. */
export function interpretationLimitations(values: string[]): string[] {
  const dimensions: Record<string, string> = {
    pacing: "配速", heartRate: "心率", power: "功率", speed: "速度",
    speedStability: "速度稳定性", crossSensorAlignment: "多传感器联合分析",
  };
  return [...new Set(values.map((value) => {
    if (!/^[a-zA-Z][\w.]*:[A-Z_]+(?::[\w.]+)*$/.test(value)) return value;
    const [dimension, reason] = value.split(":");
    const label = dimensions[dimension.split(".")[0]] ?? "该维度";
    if (reason === "NO_COMMON_WINDOW") return `${label}缺少共同有效的数据时段，暂不作联合判断。`;
    if (reason === "NP_OR_POWER_MISSING") return `${label}缺少标准化功率或平均功率，暂不计算功率变异指数。`;
    if (reason === "NP_OR_HR_MISSING") return `${label}缺少标准化功率或平均心率，暂不计算效率因子。`;
    return `${label}的有效数据不足，相关结论暂不展开。`;
  }))];
}
