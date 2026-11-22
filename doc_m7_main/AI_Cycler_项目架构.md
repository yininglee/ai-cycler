# AI Cycler 项目架构

依据当前工作区源码梳理，提交基点为 `23c4230`。各图描述代码中的调用和数据流向，外部服务分支是否运行取决于会话和部署配置。

## 1. 系统总图

AI Cycler 是一个 Next.js App Router 应用。页面渲染、HTTP 接口、骑行数据处理和 AI 编排都位于同一个 Node.js 应用。首页 `/` 跳转到 `/chat`。对话、骑行日历和详情由服务端页面读取数据，浏览器组件通过同源 API 提交上传、解读、对话和训练操作。

```mermaid
flowchart TB
    Rider["骑行者"]
    subgraph Web["浏览器"]
        UI["React 交互组件<br/>对话、骑行、训练、个人资料"]
        History["localStorage<br/>对话记录"]
        UI <--> History
    end
    subgraph App["Next.js App Router · Node.js"]
        direction TB
        Pages["服务端页面<br/>/chat · /import · /rides/:id"]
        API["路由处理器 · app/api<br/>开发会话 Cookie 提供用户身份"]
        Import["骑行导入与平台同步<br/>src/imports · src/parsers · src/sync"]
        Analysis["骑后解读<br/>src/ai"]
        Chat["对话 Agent 与工具<br/>src/chat"]
        Training["训练计划与执行<br/>src/training"]
        Domain["骑行与训练领域计算<br/>src/domain"]
        Data["骑行读取视图与持久化<br/>src/persistence"]
        API --> Import & Analysis & Chat & Training
        Pages --> Data
        Pages --> Domain
        Import --> Data
        Analysis --> Data & Domain
        Chat --> Data & Domain & Training
        Training --> Data & Domain
        API -->|资料、同意记录、账户与事件| Data
    end
    subgraph Local["本地数据目录"]
        JSON[("application-state.json<br/>骑行、资料、解读、同步、同意与事件")]
        SQLite[("training-plans.sqlite<br/>计划、执行、确认凭据与审计")]
    end
    Rider --> UI
    UI -->|页面导航| Pages
    UI -->|同源 HTTP| API
    Data --> JSON & SQLite
    Import -->|手动同步试验| OneLap["顽鹿 OTM"]
    Analysis -->|V2| Models["硅基流动"]
    Chat -->|分类与主对话| Models
    Chat -.->|可配置的主对话提供方| HTTP["自建 HTTP 端点"]
    Training -->|计划草案生成| Models
```

- **页面入口** · [对话首页](../app/chat/page.tsx)、[骑行记录和日历](../app/import/page.tsx)、[骑行详情](../app/rides/[id]/page.tsx)、[平台连接](../app/connections/[provider]/page.tsx)、[训练计划详情](../app/plans/[id]/page.tsx)、[个人资料](../app/profile/page.tsx)。
- **领域层** · 统一的 `RideRecord` 包含活动摘要 `activity` 和时序数据 `series`。功率、心率区间、海拔、坡段、路线、历史比较和负荷等指标由领域代码计算。骑行详情用 `src/ui` 将记录转换为图表和页面视图模型，AI 链路按各自协议投影证据。[骑行数据契约](../src/domain/ride-schema.ts) · [骑行视图模型](../src/ui/ride-view-model.ts)

## 2. 骑行导入与同步

```mermaid
flowchart TB
    Upload["用户上传 FIT / GPX"] --> UploadAPI["POST /api/rides/import<br/>限流、文件大小和声明类型检查"]
    Sync["用户手动操作平台连接"] --> Platform["GET / POST /api/platform"]
    Platform -->|指定用户且开启真实同步| Pilot["顽鹿试验服务<br/>读取活动列表、下载 FIT、记录同步状态"]
    Pilot <-->|服务端请求| OneLap["顽鹿 OTM"]
    Platform -->|常规演示路径| Demo["模拟连接、同步或添加样例"]
    UploadAPI --> Import["importRideBytes<br/>计算内容哈希，交由仓储去重"]
    Pilot --> Import
    Import -->|未命中重复记录时解析| Parse["FIT / GPX 解析器<br/>生成 RideRecord"]
    Parse --> Store[("应用仓储<br/>标准记录、内容哈希、顽鹿来源索引")]
    Pilot -->|连接与同步结果| Store
    Demo --> Store
    Store --> Read["getRideRepository<br/>按用户读取，合并只读演示骑行"]
    Fixtures["演示骑行 fixtures"] --> Read
    Read --> Consumers["对话、日历、详情、解读及训练服务"]
```

手动上传和顽鹿真实同步复用 `importRideBytes`。仓储按用户与内容哈希去重，顽鹿同步另记来源活动索引。同步响应包含新增、重复和失败数量。真实同步默认关闭，开启后仅对配置指定的本地会话生效，由用户手动触发。演示模式的读取视图会合并仓储和内置演示记录，空白模式的骑行列表仅包含切换后新增的自有记录。

[文件上传路由](../app/api/rides/import/route.ts) · [共享导入服务](../src/imports/ride-import-service.ts) · [解析器入口](../src/parsers/index.ts) · [平台接口](../app/api/platform/route.ts) · [顽鹿同步服务](../src/sync/onelap-sync.ts) · [演示骑行读取视图](../src/persistence/demo-ride-repository.ts) · [同步技术方案](Cycler_第三方骑行自动同步技术方案.md)

## 3. 骑后解读

```mermaid
flowchart TB
    Sheet["骑行详情 · 解读抽屉"] -->|"常规打开：GET /api/ride-analysis"| Cache{"有匹配的成功缓存？"}
    Cache -->|有| Render["抽屉展示解读与图表，或降级提示"]
    Cache -->|无| Post["POST /api/ride-analysis"]
    Sheet -->|强制刷新| Post
    Post --> Gate["读取骑行、构建分析上下文<br/>检查安全风险与解读开关"]
    Gate -->|已启用 V2| V2Input["结合用户资料与骑行时间窗计算可分析的维度<br/>组装证据与知识，校验模型输入"]
    V2Input -->|证据与输入校验通过| Model["硅基流动"]
    Model --> V2Output["输出校验、必要时修复<br/>组装解读并绑定骑行图表"]
    V2Output --> Result["成功结果或带原因的降级响应"]
    V2Input -->|证据不足或输入超限| Result
    Gate -->|安全停止、AI 关闭等| Result
    Result --> Render
    Result -->|有会话且走仓储记录分支| Saved[("运行结果与成功缓存")]
    Saved -.-> Cache
```

- **生成解读** · 用户打开抽屉，有匹配的 V2 成功结果就直接展示。首次生成或点击“重新解读”时，V2 将本次骑行证据交给硅基流动。安全停止返回 `safety_stop`，AI 关闭、凭据缺失或生成失败时返回 `b0` 和具体原因。[解读接口](../app/api/ride-analysis/route.ts) · [解读抽屉](../app/components/interpretation-view.tsx)
- **缓存和分析范围** · 服务端按账号读取缓存，核对骑行记录、相关身体指标、模型和 V2 版本。旧版报告会在下次打开时重新生成。单次解读只使用这趟骑行的证据，历史比较和 PMC 负荷由对话工具提供。[缓存指纹](../src/ai/ride-interpretation-cache.ts) · [V2 解读服务](../src/ai/ride-interpretation-service-v2.ts) · [对话工具](../src/chat/chat-tools.ts)

## 4. 骑行对话 Agent

```mermaid
flowchart TB
    Chat["对话首页 · 当前问题、摘要和可选记录引用"]
    Chat -->|POST /api/chat| Gateway["签名会话、限流、摘要校验与本地规则"]
    Gateway -->|规则可直接处理| Direct["确定性答复或安全停止"]
    Gateway -->|规则未命中且已启用| Classifier["硅基流动边界分类器"]
    Classifier -->|边界命中或分类失败| Direct
    Classifier -->|允许| Context["上下文与骑行锚点<br/>按需发起澄清或让用户选记录"]
    Gateway -->|规则未命中且未配置分类器| Context
    Context --> Agent["统一 Agent 工具循环"]
    Agent <-->|工具请求、证据、生成结果| Provider["硅基流动或自建 HTTP 模型端点"]
    Agent <-->|在白名单与预算内调用| Tools["服务端工具<br/>骑行、历史、负荷、知识、资料与训练"]
    Tools --> Records["用户骑行仓储、领域规则和训练服务"]
    Agent --> Check["回复与证据校验<br/>必要时修复或降级"]
    Check --> Response["文本、记录选择、结构化卡片与快捷操作"]
    Direct --> Response
    Response --> Chat
```

对话历史保存在当前浏览器的 `localStorage`，每轮由客户端发送问题以及允许的会话摘要。服务端依据用户身份读取记录并约束工具输入，模型处理结构化上下文和工具返回的证据。训练工具可读取状态、准备资料或生成草案。激活计划和绑定骑行在专用训练接口完成确认。

[对话入口](../app/api/chat/route.ts) · [会话存储](../src/chat/chat-session.ts) · [边界分类](../src/chat/chat-classifier.ts) · [Agent 与提供方](../src/chat/chat-agent.ts) · [工具循环](../src/chat/chat-tool-orchestration.ts) · [交互产物](../src/chat/chat-artifacts.ts)

## 5. 训练计划与执行

```mermaid
flowchart TB
    Start["对话工具 / 训练界面"] --> Intake["收集训练目标、时间安排与身体状况"]
    Profile["用户资料与近 28 天实际骑行<br/>也可使用用户自报训练基础"] --> Draft
    Intake -->|确认资料后生成| Draft["模型生成草案<br/>领域约束、版本与日历校验"]
    Start -->|已有草案的对话调整| Draft
    Draft --> Activate["专用计划接口<br/>发放确认凭据，用户确认激活"]
    Activate --> Plan["已生效的版本化训练计划"]
    Plan --> Link["执行接口<br/>选择训练日期和实际骑行，用户确认关联"]
    Ride["仓储中的 RideRecord"] --> Link
    Link --> Assess["计算执行事实<br/>可通过对话生成评估反馈"]
    Draft --> DB[("SQLite 训练工作区<br/>草案、计划版本、执行记录与确认审计")]
    Activate --> DB
    Link --> DB
    Assess --> DB
```

计划接口负责资料确认、草案生成、激活和删除，执行接口负责关联骑行和评估。激活、删除与关联通过确认凭据、版本检查和幂等回执约束写入。SQLite 将业务状态、确认凭据消耗、回执和审计同事务提交。草案生成复用硅基流动对话提供方配置。

[训练计划接口](../app/api/training-plans/route.ts) · [草案生成](../src/training/plan-generation.ts) · [计划服务](../src/training/plan-service.ts) · [训练执行接口](../app/api/training-execution/route.ts) · [执行服务](../src/training/execution-service.ts) · [确认写入](../src/chat/chat-write-confirmation.ts) · [SQLite 仓储](../src/persistence/training-plan-store.ts)

## 6. 运行边界与代码定位

- **会话与存储** · 开发会话使用签名 Cookie，应用仓储按用户 ID 读写数据。默认数据目录为 `.local-data/`，可通过 `LOCAL_DATA_DIR` 覆盖。开启 OIDC 模式会停用开发会话，当前 OIDC 适配器待接入。[会话实现](../src/auth/session.ts) · [应用仓储](../src/persistence/application-repository.ts)
- **配置来源** · 骑后解读由 `AI_ANALYSIS_ENABLED` 控制，启用时读取 `SILICONFLOW_API_TOKEN`。主对话可选硅基流动或自建 HTTP 端点，边界分类器独立启用。[环境示例](../.env.example) · [对话提供方选择](../src/chat/chat-agent.ts) · [分类器配置](../src/chat/chat-classifier.ts)
- **演示与观测** · `/pmc` 是占位页面。符合数据条件时，对话工具可计算 CTL、ATL、TSB。应用通过 `/api/demo-events` 记录或查询演示事件，导入、解读和对话也会记录服务端事件。[PMC 页面](../app/pmc/page.tsx) · [PMC 计算](../src/domain/ride-pmc-load-v2.ts) · [事件接口](../app/api/demo-events/route.ts)
- **验证入口** · `pnpm verify` 运行 TypeScript 检查和 Node 测试。测试覆盖解析导入、路由、仓储、解读、对话与训练。基线说明包含样例和测评资产的位置。[项目命令](../package.json) · [基线索引](AI_Cycler_基线索引.md)
