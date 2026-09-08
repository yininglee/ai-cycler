import type { RideRecord } from "./ride-schema.ts";
import { ROUTE_MATCH_RULES_VERSION } from "./historical-comparison.ts";

/**
 * MVP-REPEAT-01 同路线签名（route-match-key-v0.1）：
 * 基于隐私安全的相对归一化轨迹派生稳定的路线匹配键。
 * 规则：8×8 网格量化 → 折叠连续重复格子 → 规范化循环序列（环线不同起点不变）
 * → FNV-1a 签名 + 500m 距离桶。粗网格容忍 GPS 噪声与两次记录的包围盒差异；
 * 反向骑行不匹配（保守）；路线点数 < 8 或无有效距离时不生成键（同路线组隐藏）。
 */

const GRID_SIZE = 8;
const MIN_ROUTE_POINTS = 8;
const MIN_DISTINCT_CELLS = 3;
const MAX_CELL_SEQUENCE = 1_024;
const DISTANCE_BUCKET_M = 500;

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function cellOf(x: number, y: number): number {
  const column = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor(x * GRID_SIZE)));
  const row = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor(y * GRID_SIZE)));
  return row * GRID_SIZE + column;
}

/** 折叠连续重复格子，得到访问格子序列。 */
function collapseCells(cells: number[]): number[] {
  const collapsed: number[] = [];
  for (const cell of cells) {
    if (collapsed.length === 0 || collapsed[collapsed.length - 1] !== cell) collapsed.push(cell);
  }
  return collapsed;
}

/** 规范化循环序列：闭合环线（首尾同格）先去尾，再取字典序最小的旋转，使环线不同起点得到同一签名。 */
function canonicalRotation(cells: number[]): number[] {
  const sequence = cells.length > 1 && cells[0] === cells[cells.length - 1]
    ? cells.slice(0, -1)
    : cells;
  if (sequence.length <= 1) return sequence;
  let best = sequence;
  for (let shift = 1; shift < sequence.length; shift += 1) {
    const rotated = [...sequence.slice(shift), ...sequence.slice(0, shift)];
    for (let index = 0; index < rotated.length; index += 1) {
      if (rotated[index]! < best[index]!) { best = rotated; break; }
      if (rotated[index]! > best[index]!) break;
    }
  }
  return best;
}

/** 从标准化骑行记录派生同路线匹配键；无法可靠派生时返回 undefined。 */
export function deriveRouteMatchKey(record: RideRecord): string | undefined {
  const routePoints = record.series.points
    .map((point) => point.route)
    .filter((route): route is { x: number; y: number } =>
      route !== undefined && Number.isFinite(route.x) && Number.isFinite(route.y));
  if (routePoints.length < MIN_ROUTE_POINTS) return undefined;

  const distance = record.activity.metrics.distanceM;
  if (!distance || distance.qualityStatus !== "valid" || !Number.isFinite(distance.value) || distance.value <= 0) return undefined;

  const cells = collapseCells(routePoints.map((point) => cellOf(point.x, point.y)));
  if (cells.length < MIN_DISTINCT_CELLS || cells.length > MAX_CELL_SEQUENCE) return undefined;

  const signature = fnv1a(canonicalRotation(cells).join(",")).toString(36);
  const distanceBucket = Math.round(distance.value / DISTANCE_BUCKET_M);
  return `${ROUTE_MATCH_RULES_VERSION}:${GRID_SIZE}:${signature}:${distanceBucket}`;
}
