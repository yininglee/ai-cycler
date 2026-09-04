# IF / TSS（TrainingPeaks 骑行功率体系，Coggan模型）
> 前置
- **FTP**：功能阈值功率，你大约可以稳定维持60分钟的最大功率；常用20分钟最大功率×0.95估算。
- **NP Normalized Power 规范化功率**：取30\(\displaystyle TSS=\frac{t_{秒} \times NP \times IF}{FTP \times 3600} \times 100\)滚动平均功率的四次方根再开四次方，抹平滑行、爆冲，还原真实生理消耗，**TSS、IF全部基于NP，不是平均功率**。

## IF 强度因子 Intensity Factor
**公式：$\boldsymbol{IF = NP \div FTP}$**
含义：本次骑行**相对自身阈值的强度**，只看猛不猛，不看骑多久。

### IF参考区间（通用）
| IF | 训练类型 |
|---|---|
| ＜0.75 | 恢复骑、休闲Z2 |
| 0.75‑0.85 | 长距离耐力骑 |
| 0.85‑0.95 | Tempo节奏骑 |
| 0.95‑1.05 | FTP阈值区间 |
| ＞1.05 | 超阈值、间歇、比赛 |

> IF=1.0：全程等效FTP强度；1小时IF=1.0，TSS=100。

## TSS 训练压力分数 Training Stress Score
**简化公式：$\boldsymbol{TSS = \(\boldsymbol{TSS = 骑行小时数 \times IF^2 \times 100}\) \times IF^2 \times 100}$**
完整公式：$\displaystyle TSS=\frac{t_{\(\displaystyle TSS=\frac{t_{秒} \times NP \times IF}{FTP \times 3600} \times 100\)} \times NP \times IF}{FTP \times 3600} \times 100$

> 核心：**IF做平方，强度对训练压力放大效应极强**。同样骑1小时：
- IF=1.0 → 100 TSS
- IF=0.7 → 49 TSS

含义：综合**强度+时长**，量化单次骑行带给身体的总生理负荷，用来监控疲劳、安排恢复，**TSS是压力，不等于进步**。

### 单次TSS经验值（业余骑手）
- ＜50：低负荷恢复骑，几乎不累积疲劳
- 50‑100：常规训练，1天基本恢复
- 100‑150：中等负荷，次日会累
- 150‑250：大负荷长距离，需要2天以上恢复
- ＞250：比赛/超大强度，警惕过度训练

### 衍生：hr‑TSS
没有功率计，用心率估算TSS；短时间爆发间歇误差很大，仅适合长距离有氧参考。

## NP、IF、TSS快速区分
- **NP**：修正后的等效功率（客观生理消耗）
- **IF**：相对于你自己FTP有多猛（强度）
- **TSS**：这次骑行一共给身体多少压力（强度×时间）

## PMC性能管理图表衍生指标（由每日TSS计算）
1. **CTL Chronic Training Load长期训练负荷**：约42天加权TSS，代表**体能基础**，上涨慢、掉得慢。
2. **ATL Acute Training Load短期训练负荷**：约7天加权TSS，代表**当前疲劳**，涨跌反应很快。
3. **TSB Training Stress Balance训练压力平衡 = CTL − ATL**：代表竞技状态。
    - 负值：疲劳大于体能，训练堆量阶段；过负容易过度训练
    - 0~+15：状态很好，适合比赛（减量Taper后）

### 示例演算
1. 休闲骑2h，IF=0.7
$TSS=2 \times 0.7^2 \times100 = \boldsymbol{98}$
2. FTP训练1h，IF=1.0
$TSS=1\times1.0^2\times100=\boldsymbol{100}$
3. 间歇课30min，IF=1.1
$TSS=0.5\times1.1^2\times100=\boldsymbol{60.5}$

## 常见坑点
1. **FTP不准，IF/TSS全部失真**。如果1小时骑行IF持续＞1.05，说明你的FTP设置偏低，需要重测阈值。
2. 不要盲目堆高周TSS，周TSS增幅建议不要超过上周**10%**，防止过度训练。
3. TSS高≠骑得好，同样TSS，间歇课与低强度垃圾量的训练收益天差地别。

如果你需要，我可以把 **VI变异指数、Coggan功率区间Z1‑Z7** 一并整理成可复制的笔记。