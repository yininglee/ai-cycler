# AGT-B 部署决策与 m6 前端同步方案

> 2026-10-26 · 用户决策：**暂缓部署 m7，待 m6 在做的前端改动同步过来后再部署**
> 事实前提（此前曾搞错）：**m7 分支从未部署**，线上运行的是 `m6-m4-optimization`。

---

## 1. 决策记录

| 项 | 内容 |
|---|---|
| 决策 | **暂缓部署 m7** |
| 前置条件 | m6 正在进行的前端界面修改先同步到 m7 |
| 顺带解决 | 原 B7 遗留项「下次部署 m7 时是否放行 `kb_qa` / `level_assessment`」→ 改为**部署前一次性决策**，不单独拍板 |
| 影响 | B 系列成果（9 工具 / L2b 循环 / 两个新路由 / V4.1-Flash）继续只存在于 m7 本地 |

---

## 2. 冲突面评估（2026-10-26 实测）

### 2.1 m6 当前有未提交改动

```
M app/components/ride-calendar-heatmap.tsx
M app/components/ride-calendar.module.css
M app/import/page.tsx
M src/ui/ride-calendar.ts
M tests/ride-calendar.test.ts
M doc_V2.1/Demo前端设计基线与模块记录.md
M doc_V2.1/V2.1_开发进度.md
```

**关键**：这些改动**尚未 commit**，必须先提交才能同步（否则只能手工拷文件）。

### 2.2 m7 侧是否有竞争改动

| 文件 | m7 相关提交 | 判断 |
|---|---|---|
| `app/components/ride-calendar-heatmap.tsx` | 仅 `2adc25e` | 该提交 **m6 也有** → 共享祖先，**m7 无独立改动** |
| `app/components/ride-calendar.module.css` | 仅 `2adc25e` | 同上 |
| `src/ui/ride-calendar.ts` | 仅 `2adc25e` | 同上 |
| `tests/ride-calendar.test.ts` | 仅 `2adc25e` | 同上 |
| **`app/import/page.tsx`** | `92e5633` / `c3c6225` / `d1f6be9` / `2adc25e` | **前三个是 m7 独有**（M3 chat / tab 切换 / 演示记录），**与 m6 的当前改动有重叠风险** |

### 2.3 差异规模（m6 工作区 vs m7）

| 文件 | 差异行数 | 风险 |
|---|---:|---|
| `app/components/ride-calendar-heatmap.tsx` | 215 | 低（m7 无独立改动，可直接采纳 m6 版） |
| `app/import/page.tsx` | 29 | **中**（双方都改过，需人工合并） |
| `src/ui/ride-calendar.ts` | 6 | 低 |
| `tests/ride-calendar.test.ts` | 8 | 低 |

**结论**：整体冲突面小，**唯一需要人工介入的是 `app/import/page.tsx`**（29 行，双方都有改动）。

---

## 3. 推荐同步步骤

### 步骤 0：m6 先提交（前置）

```bash
cd ../AI骑行伙伴-指导版_0827-m6-m4-optimization
npm test            # 确认 m6 自身绿
git add -A && git commit -m "feat(ui): 骑行日历与 import 页前端改动"
```

> m6 工作区不停留在脏状态，才能用 git 机制同步而不是手工拷文件。

### 步骤 1：在 m7 上 cherry-pick（而非 merge）

```bash
cd ../AI骑行伙伴-指导版_0827-m7-agent-autonomy
git cherry-pick <m6 的新提交 hash>
```

**为什么用 cherry-pick 不用 merge**：m7 的 B 系列是独立演进的（15 个缺陷修复 + 3 个数据集冻结），merge m6 会把 m6 的其他历史一并带进来，可能冲掉已冻结的评测资产。cherry-pick 只取那一个前端提交，范围可控。

### 步骤 2：解决 `app/import/page.tsx` 的冲突

原则：**m6 的前端展示改动优先，m7 的 agent 相关改动保留**。
m7 在该文件的独有改动来自 `92e5633`（M3 chat 接入）、`c3c6225`（演示记录与降级）、`d1f6be9`（tab 切换反馈）——这些都是**功能接线**，不能丢。

### 步骤 3：同步后必须全量回归

```bash
NODE_DISABLE_COMPILE_CACHE=1 npx tsc --noEmit
npm test                              # 期望 773/773
node scripts/preflight-ride-chat-tool-eval.ts   # 期望 PASS
```

**重点看**：`app/components/chat-validation-preview.tsx`（m7 在 B5 期间加过 `claims` 字段）是否被 m6 的前端改动波及。

### 步骤 4（建议）：跑一次冒烟评测

前端改动不影响后端逻辑，但会影响 chat 组件的展示链路。建议至少跑编排集单次（21 例 × 1）：

```bash
node --env-file=.env.local scripts/eval-tool-orchestration.ts --set=orchestration --repeat=1 --sleep=4000
```

期望 ≥20/21（95%）。

---

## 4. 部署前的其他待确认项

| 项 | 状态 | 说明 |
|---|---|---|
| 真实数据验证 | **未做** | 评测用 fixture 复制的 22 条记录，真实用户的 FIT 文件（`test-data/demo-imported-rides/*.fit` 4 条）尚未跑过完整对话链路 |
| m7 的 `.env.production` | **未纳入 git** | 部署时需单独准备，不能依赖仓库 |
| 是否放行 `kb_qa` / `level_assessment` | 待定 | 部署前一次性决策 |
| 模型版本 | `DeepSeek-V4.1-Flash` | 需确认线上环境能否访问该模型、配额是否足够 |

---

## 5. 本文档的边界

- **不含**部署操作步骤（那是 `sites` 技能/部署流程的事，且需用户授权）
- **不含** m6 前端改动的设计评审（属 m6 自己的范围）
- 目的只有一个：**让"暂缓部署"这个决策有据可查，并提前暴露同步时的冲突点**
