# 500 错误归因诊断（upload-f95e988a）· UNLOCATED_STOP_TIME 下的证据源归属错误

> 日期：2026-10-07　骑行：upload-f95e988a-477e-4703-a2e7-0d1547fbe0b1
> 症状：`POST /api/ride-analysis` 500（V2 引擎）

## 一、结论摘要

这条骑行在 V2 解读时**抛异常**（不是 b0 降级），直接导致 HTTP 500。根因是**证据源归属错误**：

> terrain 距离（route-shape 派生，纯距离/海拔语义，**不依赖时间轴**）的 claim 被挂在了 `windowsSource` 上；而 `windowsSource` 因为 `UNLOCATED_STOP_TIME` 被标记为 `unavailable`，于是这些 claim 在校验时被判 `CLAIM_SOURCE_INVALID`，`buildRideProfileHistoryV2` 抛异常 → 500。

## 二、根因链

1. 该骑行 `stoppedTimeS = 426`，但 `stops = 0`——设备报告了 426 秒停止时间，`inferDeviceStops` 却**没能把它定位到采样里的静止 gap**（两段 gap 距离只漂移 3.3m + 7.0m，其实是静止；但 `stationaryGap` 判定误用了 gap 边界点的瞬时速度，详见第七节），所以 `unlocatedStopTimeS = 426`。
2. 容差 = `10% × span = 0.1 × 4060 = 406`，而 `426 > 406` → `unlocatedStopTolerated = false`。
3. `buildRideTemporalWindowsV2` 因此置 `unavailableReason = "UNLOCATED_STOP_TIME"`。
4. `windowsSource` 的 status 被设为 `unavailable`（L604-605）。
5. 但这条骑行的 `routeShape.isAvailable = true`（elevation 充分，coverageRatio 0.999），`terrainDistances` 照常生成——10 条 terrain claim（trend/local 三向距离 + coverageRatio + 三个 run 计数）。
6. 这 10 条 claim 原来用 `sourceRef(windowsSource, terrain.evidenceIds)`，引用了一个 unavailable 的 source。
7. `validateRideCapabilityClaimsV2` 校验到 `matching.status !== "available"` → 报 `CLAIM_SOURCE_INVALID` × 10。
8. `buildRideProfileHistoryV2` 遇到校验失败直接 throw（`S3-01 capability snapshot is invalid`），route 无 catch → 500。

## 三、本质

`windowsSource` 承载的是**时间窗口语义**（power peaks、segment sensor means、joint windows），它的可用性由时间轴与停止时间定位决定——`UNLOCATED_STOP_TIME` 时确实不可用。

但 **terrain 距离是 route-shape 派生的**（从 elevation/distance 计算坡度分段，再聚合出爬升/平路/下降里程），与时间轴、停止时间**完全无关**。它被错误地塞进了 `windowsSource`，于是被 `UNLOCATED_STOP_TIME` 连坐。

## 四、修复（已落地）

`src/domain/ride-capability-claims-v2.ts`：为 route-shape 派生数据建立**独立的 `route-shape` source**：

- `windowsSource` 不再收纳 `terrainDistances.evidenceIds`；
- 当 `windows.terrainDistances` 存在时，新建 `routeShapeSource`（kind=summary，version=terrain.rulesVersion，status=available）；
- terrain claims 的 refs 从 `windowsSource` 改为 `routeShapeSource`；
- `routeShapeSource` 加入 sourceInventory。

climb/cruise/terrain 的**段窗口**与 joint windows 仍留在 `windowsSource`——它们的 sensor means 确实依赖已定位的时间轴。

验证：该骑行 `buildRideProfileHistoryV2` 不再抛异常，26 条 claim（含 10 条 terrain）全部通过校验，sourceInventory 里 `route-shape(available)` 独立存在。

## 五、回归测试

`tests/ride-capability-claims-v2.test.ts` 新增用例：构造 `windows.unavailableReason = "UNLOCATED_STOP_TIME"` 且 `terrainDistances` 存在的场景，断言——校验通过、terrain claims ≥ 10、route-shape source 为 available、terrain claims 的 sourceRefs 指向 route-shape。

## 六、遗留观察（供后续决策）

这条骑行还有两个独立的、与本次 500 **无关**但值得留意的数据特征：

1. ~~**426 秒停止时间无法定位**~~（**已于 2026-10-08 修复，见第七节**）：设备报了 426 秒停止，此前采样序列里"找不到静止段"——根因不是"设备停止时间与采样对不上"，而是 `stationaryGap` 判定用错了数据源。
2. 该骑行几乎全平路（climb=0、descent=0、flat 30346m），所以 climb 维度天然无内容。

## 七、后续修复（2026-10-08）：`stationaryGap` 边界点速度误判

追查"426 秒停止时间无法定位"后发现，根因是一个 **`inferDeviceStops` 的 bug**，而非"设备数据边界形态"：

### 7.1 根因

`stationaryGap` 判定（判定"记录断档 gap 是否属于停止"）在"距离增量小"之外，还要求 **gap 边界点的瞬时速度 < 1 m/s**。但 `sample.speedMps`/`startSpeedMps` 是 gap **边界点**的速度（gap 前减速到停的前一刻、gap 后重新加速的后一刻），不是 gap 期间的速度。

实测 f95e 两段 gap：

| gap | 时长 | 距离增量 | 期间真实速度 | 边界点瞬时速度 | 旧判定 |
|---|---:|---:|---:|---:|---|
| 626→672 | 46s | +3.3m | 0.07 m/s（静止） | 2.09 / 1.62 m/s | ❌ 被边界点速度否掉 |
| 2398→2776 | 378s | +7.0m | 0.02 m/s（静止） | 7.49 / 4.62 m/s | ❌ 被边界点速度否掉 |

两段 gap 距离加起来只漂了 **10.3 米**——**就是静止**（GPS 漂移），但边界点瞬时速度（7.5 m/s 这种"刚恢复骑行"的值）让判据误以为"人在骑"，于是 426s 停止时间完全定位不到 → `UNLOCATED_STOP_TIME` → 段窗口/功率峰值能力关闭。

### 7.2 修复（方案 A）

`stationaryGap` 只保留"gap 距离增量小（≤50m）"这一硬证据，删除边界点速度条件：

```ts
const stationaryGap = durationS > SHORT_GAP_MAX_S
  && finite(distanceDelta)
  && distanceDelta >= -5
  && distanceDelta <= DEVICE_STOP_MAX_DISTANCE_M;
```

理由：
- gap 期间距离几乎不动本身就是静止的**最硬证据**（46s 走 3m、378s 走 7m 只可能是 GPS 漂移）；
- 边界点瞬时速度高只说明"gap 前后在骑"，**不能否认"gap 期间停了"**；
- `DEVICE_STOP_MAX_DISTANCE_M = 50` 阈值已足够保守：真慢速骑 46s 会走 >50m，会被距离阈值自然拦住。

同时删除已无用途的 `DEVICE_STOP_EDGE_SPEED_MPS` 常量与 `startSpeedMps` 死代码字段。

### 7.3 验证

| 场景 | 修复前 | 修复后 |
|---|---|---|
| f95e 静止 gap | stops=[]，unlocated=426 ❌ | 2 个 stop（46s+378s），unlocated=**2**，tolerated=true ✓ |
| 965aa12e 对照 | 10 个 stop | 10 个 stop（无回归）✓ |
| demo-08-20 记录断档反例（189s gap，距离走 412.8m） | — | 未误判为 stop ✓（`>50m` 被距离阈值挡住） |

- 回归测试 `tests/ride-timing.test.ts` 新增 2 用例：①静止 gap 但边界点高速 → 仍判 stop；②真移动 gap（距离走 325m）→ 不误判 stop。
- timing/temporal-features/capability-claims/temporal-windows 定向 44/44；全量 631/631；typecheck 通过。

至此，该骑行的两个根因都已修复：证据源归属错误（第四节）+ `stationaryGap` 边界点速度误判（本节），`UNLOCATED_STOP_TIME` 本身不再是该骑行的问题。
