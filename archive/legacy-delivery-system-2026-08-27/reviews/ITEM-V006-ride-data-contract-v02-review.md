# ITEM-V006｜无AI详情基础数据合同v0.2评审

> 日期：2026-08-19  
> 状态：`ACCEPTED`  
> 版本：`RideActivity v0.2 / RideSeries v0.1 / fit-parser-v0.2 / gpx-parser-v0.3`  
> 边界：本项实现数据合同和解析保留，不实现页面图表、真实地图底图或AI新合同。

## 1. 目标与结果

无AI单次详情现在具备可渲染的数据事实层：聚合指标继续放在`RideActivity`，轨迹与速度、海拔、心率、功率、踏频等可选时序放在独立`RideSeries`，两者通过同一`rideId`和来源版本关联。旧B0/AI服务仍可读取聚合字段，避免本项扩大到Prompt和Workflow重构。

## 2. 冻结的最小合同

### 2.1 `RideActivity v0.2`

- 保留距离、时间、速度、爬升、心率、功率、NP和踏频聚合；新增最大功率、最大踏频和设备运动消耗字段；
- 每个指标必须包含`value/unit/provenance/confidence/evidenceId/sourceField/sourceUnit/qualityStatus`；活动有开始时间时还必须包含`recordedAt`；
- 计算值继续强制`formulaVersion`，缺少溯源、质量或必要时间即合同失败；
- GPX无可信时间戳继续禁止时长和平均/最高速度。

### 2.2 `RideSeries v0.1`

- 可选序列：`route/distance/elevation/speed/heart_rate/power/cadence`；缺字段不补0；
- 每条曲线带`sourceField/unit/qualityStatus/sampleCount`，时间统一为相对活动开始的秒数；
- 路线只输出0–1相对坐标，合同中没有纬度、经度或源文件名；
- 序列与活动必须具有相同`rideId/source.kind/parserVersion`；序号、时间和距离必须单调；
- 无时间戳GPX只允许路线、距离和海拔，禁止时间及速度序列。

## 3. 解析与Fixture迁移

- 新增`parseFitRide/parseGpxRide/parseRideRecord`返回`{activity, series}`；旧`parseFitActivity/parseGpxActivity/parseRideFile`保留为只取聚合活动的兼容入口；
- FIT记录保留实际存在的距离、速度、海拔、心率、功率和踏频序列；全0功率继续按无功率处理；
- GPX先沿用已验收的GPS质量门，再生成相对路线及合规曲线；过滤后没有有效移动时间时不重新开放最高速度；
- 当前Fixture实际为14条：原始13条加`ITEM-G0-FIX-001`新增的GPS跳点回归Fixture，已全部迁移。旧文档中的“13条现有Fixture”仅描述修复前基线。

## 4. 验证证据

| 检查 | 结果 | 证据边界 |
|---|---:|---|
| TypeScript | PASS | `pnpm typecheck` |
| 自动测试 | 76/76 PASS | 含7条新序列/溯源专项测试 |
| B0确定性基准 | 14/14 PASS | 本机Fixture，不调用模型 |
| 生产构建 | PASS | Next.js生产构建成功 |
| 私有真实FIT开发验证 | 1/1 PASS | 2043点；活动/序列合同有效；非多设备兼容证据 |
| 精确坐标排除 | PASS | 序列序列化结果无`latitude/longitude`字段 |
| 无时间戳GPX降级 | PASS | 无时间、平均/最高速度和速度序列 |
| 全0功率降级 | PASS | 无功率聚合、质量能力和功率序列 |

私有真实FIT仅记录脱敏结构结果：可用序列为路线、距离、海拔、速度、心率和踏频；未把文件名、精确坐标或完整内容写入评审与日志。

## 5. 已知边界

- 本项没有把新序列接到详情页，所以用户界面暂时不会出现轨迹或曲线；下一切片才做UI渲染；
- 相对坐标排除了精确地理位置，但尚未冻结“首尾裁剪多少米”的产品规则；对外分享前仍需专项隐私处理和测试；
- 当前只对1条私有真实FIT做开发验证，不能声称Garmin/Wahoo/行者等多设备兼容；
- 运动消耗只接收FIT可信设备记录值；无值时不估算，体重/公式估算属于个人资料和规则后续切片；
- 旧Prompt、旧AI输出Schema和L1/L2/L3业务迁移不在本项，新AI基准仍为`NOT_RUN`。

## 6. 用户验收

- 验收日期：2026-08-20；
- 用户决定：明确回复`接受 ITEM-V006`，接受聚合/时序分工、当前Demo相对轨迹方案及无时间戳/缺传感器降级规则；
- 状态：`ACCEPTED`；
- 边界：本次验收不等于页面轨迹/曲线、位置隐私裁剪、运动消耗估算、多设备兼容或新AI合同已完成；
- 后续：进入`ITEM-V007`无AI详情轨迹与基础曲线UI，仍不提前进入Prompt或历史比较。
