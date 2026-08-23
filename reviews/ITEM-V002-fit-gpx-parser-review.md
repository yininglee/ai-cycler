# ITEM-V002｜真实FIT/GPX最小解析链路预览

> 状态：`ACCEPTED`  
> 日期：2026-08-17  
> Parser：v0.1  
> 上游契约：`RideActivity v0.1`、Rules v0.1（均已验收）
> 用户验收：2026-08-17，接受ITEM-V002

## 1. 本项解决什么

把FIT二进制和GPX XML真正读入程序，并转换为ITEM-V001已验收的同一套`RideActivity`。解析器只负责提取和标准化事实，L1/L2/L3、降级和拒绝仍由确定性规则决定。

## 2. 解析库决定

| 格式 | 选择 | 证据与原因 | 未选方案 |
|---|---|---|---|
| FIT | `fit-file-parser` 4.1.0 | Node≥20、ESM/TypeScript、MIT；支持标准FIT、开发字段、CRC与截断检查；可生成合规二进制做端到端测试 | Garmin官方SDK许可限制更强；当前不直接绑定 |
| GPX | `fast-xml-parser` 5.11.0 | TypeScript、MIT、维护活跃；可禁用实体处理并限制输入 | `gpxparser` 3.0.8依赖旧版jsdom，包更旧且不利于服务端最小化 |

两种第三方库都被隔离在`src/parsers/`适配层。以后替换解析库时，前端、规则和Agent仍只认`RideActivity v0.1`。

生产依赖及其当前传递依赖许可检查结果为MIT或BSD-3-Clause；TypeScript为Apache-2.0。这里只是工程许可盘点，不等同于正式法律意见。

## 3. 已实现行为

### FIT

- 以二进制读取，拒绝把FIT当文本；
- 默认严格校验FIT头、文件长度和CRC；
- 只选择骑行/电助力骑行Session；非骑行返回稳定错误；
- 当前一个文件只接受一段骑行，多Session明确拒绝，避免静默漏掉数据；
- 提取距离、总/移动时间、爬升、均速/最高速度、心率、功率、NP和踏频；
- 基于Record覆盖率计算GPS/心率/功率/踏频质量；
- 若FIT把“无有效功率”编码为全程0W，则不输出功率指标和功率质量声明，并记录`FIT_ALL_ZERO_POWER_IGNORED`，避免误判为L3；
- 检测到开发字段时保留标准字段并告警，当前不使用私有字段。

### GPX

- XML结构校验；禁用实体处理并主动拒绝DOCTYPE/ENTITY；
- 单文件最大25MB，轨迹点最多20万；
- 校验经纬度范围；
- 用Haversine v0.1计算距离；
- 用相邻海拔正差计算爬升，标为中置信度；
- 时间戳完整且递增时计算总时间、移动时间和均速；
- 时间戳缺失/无效/倒退时不生成时间和速度，只保留可信事实。

### 错误合同

解析失败不会向上抛出第三方库的随机文案，而是转换为稳定错误码，例如：

- `FIT_INVALID_OR_CORRUPT`
- `FIT_NO_CYCLING_SESSION`
- `FIT_MULTIPLE_CYCLING_SESSIONS`
- `GPX_UNSAFE_XML`
- `GPX_INVALID_XML`
- `GPX_INVALID_COORDINATES`
- `FILE_EMPTY` / `FILE_TOO_LARGE`

## 4. 自动验证

- `pnpm typecheck`：通过；
- `pnpm test`：28/28通过，0失败；
- 其中解析器新增11项测试，覆盖：
  - 由FIT Encoder生成的标准合规二进制端到端解析；
  - FIT截断、CRC错误、非骑行、多Session；
  - FIT全程0W占位值不得生成L3能力或功率质量声明；
  - GPX有时间戳、无时间戳、恶意XML、XML损坏、非法坐标；
  - FIT文本输入、未知扩展名、非法UTF-8、空文件和超限；
- 协作文档严格检查：`0 error / 0 warning`。

测试中的FIT是**标准合规的生成二进制**，确实经过FIT解码器和CRC验证；GPX是合成XML。它们不是用户真实码表文件，因此不能证明Garmin/Wahoo/行者/迈金等设备已兼容。

## 5. 本地真实文件检查入口

真实数据无需上传到扣子或模型。把文件放在本机后运行：

```bash
pnpm inspect:ride -- /绝对路径/你的骑行.fit
```

也支持`.gpx`。命令只在本地读取并输出解析结果、验证结果与L1/L2/L3能力，不写数据库。项目已忽略`test-data/private/`，可将敏感样本放入该目录，避免误提交。

### 用户真实FIT验证（2026-08-17）

- 样本：用户提供的真实FIT 1个；仅在本机执行，文件位于Git忽略目录，未上传模型或外部服务；
- 解析结果：1/1成功，`RideActivity v0.1`验证通过，能力等级为L2；
- 可用数据：GPS、心率、踏频及基础骑行汇总正常保留；
- 真实兼容发现：该文件包含开发字段，并把无有效功率记录为全程0W；初始实现因此误判L3；
- 修正结果：全0W不再生成`avgPowerW`、`normalizedPowerW`或`sensorQuality.power`，同时保留明确警告；
- 隐私处理：验证证据只记录能力等级、字段类别、警告码和通过状态，不记录原始轨迹、坐标或具体骑行时间。

这证明当前解析链路兼容这1个真实FIT样本，不代表所有设备或厂商FIT均已兼容。

## 6. 尚未验证与已知限制

- `PARTIAL`：用户真实FIT已验证1个且1/1成功；用户真实GPX仍为`NOT_RUN`；
- `NOT_RUN`：Garmin/Wahoo/行者/迈金等设备兼容矩阵；
- `NOT_RUN`：厂商私有开发字段映射；
- `NOT_RUN`：超大文件的性能/内存基准；
- 多Session FIT当前明确拒绝，不做合并；
- GPX心率/踏频扩展暂不读取，GPX当前按L1处理；
- GPX爬升是简单正差，尚未做海拔噪声平滑；
- 尚无上传API、页面、数据库、扣子和模型调用。

## 7. 请用户重点确认

1. 接受`fit-file-parser` + `fast-xml-parser`作为Demo解析基线；
2. FIT默认严格CRC，损坏文件拒绝，不做强制容错；
3. 多Session FIT首期拒绝，遇到真实需求再设计拆分/合并；
4. GPX无可靠时间戳时不计算时间和速度；
5. 当前已完成1个真实FIT验证；是否接受该证据作为ITEM-V002基线，并把更多设备样本留到后续兼容矩阵持续补充。

当前建议：接受ITEM-V002作为Demo解析基线。证据范围应准确表述为“1个真实FIT样本兼容”，不能扩大为“FIT设备兼容已全面验证”；后续每出现一个新设备或失败样本，都应加入回归集与兼容矩阵。
