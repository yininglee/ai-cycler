/**
 * DEMO-IMPORTED-RIDES：服务端加载器（仅服务端可用，含 node:fs 与解析器）。
 *
 * 从 test-data/demo-imported-rides/ 读取真实 FIT 文件并按应用自身的解析边界
 * （parseRideRecord）转换成 RideRecord —— 与用户上传导入走的是同一条链路，
 * 因此这些演示记录在详情页、AI 解读、聊天聚合里的表现与真实导入完全一致。
 *
 * 代价与取舍：
 * - 原始 FIT 合计约 0.9 MB，解析后记录约 7 MB（含完整轨迹点）。
 * - 解析结果在模块级缓存，进程内只解析一次（实测 16–99 ms / 条）。
 * - 数据只存在于内存，不写入 .local-data，也不属于任何会话，因此零存储成本、
 *   重启不丢失、任何访客看到的内容完全一致。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { RideRecord } from "../domain/ride-schema.ts";
import { parseRideRecord } from "../parsers/index.ts";
import { DEMO_IMPORTED_RIDES, isDemoImportedRideId } from "./demo-imported-ride-manifest.ts";

export type DemoImportedRide = {
  rideId: string;
  capability: string;
  title: string;
  note: string;
  /** 列表排序用的时间戳：取骑行开始时间，让演示记录天然按日期倒序排列。 */
  storedAt: string;
  record: RideRecord;
};

const DATA_DIR = path.join(process.cwd(), "test-data", "demo-imported-rides");

/**
 * 开关：默认启用。自动化测试把它置为 "false"，让用例在「没有任何演示记录」的
 * 干净基线上断言产品契约 —— 与 tests/helpers/route-test-env.ts 隔离 LOCAL_DATA_DIR 同理，
 * 演示数据属于运行时数据集，不应参与契约测试。
 */
const ENABLED_FLAG = "DEMO_IMPORTED_RIDES_ENABLED";

function isEnabled(): boolean {
  return process.env[ENABLED_FLAG] !== "false";
}

let cache: Promise<DemoImportedRide[]> | null = null;

async function parseOne(entry: typeof DEMO_IMPORTED_RIDES[number]): Promise<DemoImportedRide> {
  const content = new Uint8Array(await readFile(path.join(DATA_DIR, entry.fileName)));
  const record = await parseRideRecord({ rideId: entry.rideId, fileName: entry.fileName, content });
  return {
    rideId: entry.rideId,
    capability: entry.capability,
    title: entry.title,
    note: entry.note,
    storedAt: record.activity.startTime ?? new Date(0).toISOString(),
    record,
  };
}

async function load(): Promise<DemoImportedRide[]> {
  if (!isEnabled()) return [];
  const parsed = await Promise.all(DEMO_IMPORTED_RIDES.map(async (entry) => {
    try {
      return await parseOne(entry);
    } catch (error) {
      // 演示数据缺失不应该让整个应用挂掉：跳过该条并留下可诊断日志。
      console.error(`[demo-imported-rides] 解析失败 ${entry.fileName}:`, error instanceof Error ? error.message : error);
      return null;
    }
  }));
  return parsed.filter((item): item is DemoImportedRide => item !== null);
}

/** 列出全部演示「已导入」记录（进程内只解析一次）。 */
export function loadDemoImportedRides(): Promise<DemoImportedRide[]> {
  if (!cache) cache = load();
  return cache;
}

export async function getDemoImportedRide(rideId: string): Promise<DemoImportedRide | undefined> {
  if (!isDemoImportedRideId(rideId)) return undefined;
  return (await loadDemoImportedRides()).find((item) => item.rideId === rideId);
}

/**
 * 供仓储装饰器合并进 listRides 使用。
 *
 * 这里返回结构化克隆：缓存是进程级共享的，而 FileApplicationRepository.listRides
 * 也返回克隆，调用方因此可以假定自己独占返回的对象。克隆 4 条记录约 7 MB，
 * 单次页面渲染只发生一到两次，代价可接受；换来的是任何下游误改都不会污染缓存。
 */
export async function listDemoImportedRideEntries(): Promise<Array<{ record: RideRecord; storedAt: string }>> {
  return (await loadDemoImportedRides()).map(({ record, storedAt }) => ({ record: structuredClone(record), storedAt }));
}
