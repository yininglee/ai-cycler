import type { RideRecord } from "../domain/ride-schema.ts";
import type { ChatToolResult } from "./chat-tools.ts";
import { chatRideCandidates } from "./chat-ride-ref.ts";
import { calendarDuration } from "../ui/ride-calendar.ts";
import { formatRideTitle } from "../ui/ride-view-model.ts";
import { sanitizeChatInteractionPayload, type ChatRideListItem, type ChatArtifact, type ChatChoice, type ChatQuickAction } from "./chat-interaction.ts";

/** UI proposals are derived only from completed, authorized preparation tools. */
export function buildChatUserInteraction(results: readonly ChatToolResult[]) {
  const prepared = [...results].reverse().find(result => "interaction" in result && result.interaction?.artifact);
  const { droppedFields: _, ...interaction } = sanitizeChatInteractionPayload(prepared && "interaction" in prepared ? prepared.interaction ?? {} : {});
  return interaction;
}

/** Presentation is projected from authorized tool results, never from model-authored IDs. */
export function buildChatRecordInteraction(results: readonly ChatToolResult[], records: readonly RideRecord[], selectionNeeded = false, candidateIds?: readonly string[]): { artifact?: ChatArtifact; choices?: ChatChoice[]; quickActions?: ChatQuickAction[] } {
  const history = [...results].reverse().find(r => r.tool === "get_ride_history");
  const ids = history?.tool === "get_ride_history" ? history.rows.map(r => r.rideId) : results.flatMap(r => r.tool === "find_ride" ? r.matches.map(m => m.rideId) : "rideId" in r && typeof r.rideId === "string" ? [r.rideId] : []);
  const authorized = [...new Set(selectionNeeded ? candidateIds ?? chatRideCandidates(records.map(record => ({ record })), 20).map(c => c.rideId) : ids)].filter(id => records.some(record => record.activity.rideId === id));
  const items: ChatRideListItem[] = authorized.slice(0, 20).flatMap(id => {
    const record = records.find(r => r.activity.rideId === id);
    if (!record) return [];
    const metric = (key: keyof RideRecord["activity"]["metrics"]) => { const m = record.activity.metrics[key]; return m && Number.isFinite(m.value) && m.value >= 0 ? m.value : undefined; };
    const distance = metric("distanceM"), duration = metric("movingTimeS") ?? metric("elapsedTimeS");
    return [{ rideId: id, dateLabel: record.activity.startTime ? new Date(record.activity.startTime).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "日期未记录", title: formatRideTitle(record.activity.startTime), ...(distance !== undefined ? { distanceKm: distance / 1000 } : {}), ...(duration !== undefined ? { durationLabel: calendarDuration(duration) } : {}), hasHeartRate: metric("avgHeartRateBpm") !== undefined, hasPower: metric("avgPowerW") !== undefined }];
  });
  if (!items.length) return {};
  const totalCount = selectionNeeded ? authorized.length : history?.tool === "get_ride_history" ? Math.max(history.rideCount, items.length) : authorized.length;
  const { droppedFields: _dropped, ...interaction } = sanitizeChatInteractionPayload({
    artifact: { kind: "ride_list", payload: { items, totalCount, truncated: totalCount > items.length } },
    ...(selectionNeeded ? { choices: items.slice(0, 8).map(item => ({ kind: "ride", id: item.rideId, label: item.dateLabel, sublabel: item.distanceKm === undefined ? "距离未记录" : `${item.distanceKm.toFixed(1)} km` })) } : {}),
    quickActions: items.slice(0, 4).map(item => ({ kind: "deepAnalysis", rideId: item.rideId, dateLabel: item.dateLabel })),
  });
  return interaction;
}
